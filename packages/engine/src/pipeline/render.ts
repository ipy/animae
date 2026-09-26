import type { Kernel, RetrievalHit, TurnCtx } from "../contracts.ts";
import type { ToolDef } from "../ports.ts";
import type { Choice, EventDraft } from "../types.ts";
import { AnimaeError } from "../types.ts";
import { z } from "zod";
import { descriptorToZod } from "../entities/descriptor.ts";
import { getPromptSection } from "../prompts/index.ts";
import { buildRenderSchema } from "./schemas.ts";
import { buildPromptSegments } from "./prompt.ts";
import { routerBudgetK } from "../router/policy-access.ts";
import type { RenderInput, RenderPart, RenderResult } from "./types.ts";
import { modelCelExtra } from "./model-cel.ts";

function textDelta(prev: string, next: string): string | null {
  if (next === prev) return null;
  if (next.startsWith(prev)) return next.slice(prev.length);
  return null;
}

async function resolveHits(k: Kernel, i: RenderInput, t: TurnCtx): Promise<RetrievalHit[]> {
  if (i.hits && i.hits.length > 0) return i.hits;
  const ctx = k.celContext({
    self: i.speaker,
    other: i.addressee,
    event: i.appraisal,
    sceneId: i.scene.id,
    extra: modelCelExtra(k, i.tier),
  });
  const salience = i.fieldEffects.salience;
  const raw = await k.m.memory.retrieve({
    owner: i.speaker,
    terms: i.appraisal.search_terms,
    tags: i.appraisal.tags,
    location: i.scene.location,
    salience,
    ctx,
    now: k.timeline.now(),
    limit: k.policy.memory.k,
  });
  const rngKey = `${t.turnId}:render:distort`;
  return k.m.memory.distort(raw, rngKey);
}

export function buildS2Tools(k: Kernel, speaker: string): ToolDef[] {
  const ploc = k.i18n.promptLocale;
  const searchInput = z.strictObject({
    query: z.string(),
    scope: z.string().optional(),
    tags: z.array(z.string()).optional(),
  });
  const readInput = z.strictObject({ id: z.string() });

  return [
    {
      name: "search",
      description: getPromptSection(ploc, "tool_search_description"),
      input: searchInput,
      execute: async (input) => {
        const q = input as { query: string; scope?: string; tags?: string[] };
        const terms = q.query.split(/\s+/).filter(Boolean);
        const ctx = k.celContext({
          self: speaker as import("../types.ts").CharacterId,
          extra: modelCelExtra(k, "s2"),
        });
        const hits = await k.m.memory.retrieve({
          owner: speaker as import("../types.ts").CharacterId,
          terms,
          tags: q.tags,
          scope: q.scope,
          ctx,
          now: k.timeline.now(),
          limit: k.policy.memory.k,
        });
        return hits.map((h) => ({ id: h.id, kind: h.kind, score: h.score, text: h.text.slice(0, 300) }));
      },
    },
    {
      name: "read",
      description: getPromptSection(ploc, "tool_read_description"),
      input: readInput,
      execute: (input) => {
        const id = (input as { id: string }).id;
        const doc = k.m.memory.readDoc(id);
        return doc ?? { error: "not_found", id };
      },
    },
  ];
}

function cueSchemaForType(policy: Kernel["policy"], type: string): z.ZodType<unknown> | undefined {
  const def = policy.cues.types[type];
  if (!def) return undefined;
  const argsShape: Record<string, z.ZodType<unknown>> = {};
  for (const [arg, fd] of Object.entries(def.args ?? {})) {
    argsShape[arg] = descriptorToZod(fd);
  }
  return z.strictObject({
    type: z.literal(type),
    args: z.strictObject(argsShape),
    at: z.number().int().min(0).optional(),
  });
}

function validateCues(
  raw: { type: string; args: Record<string, unknown>; at?: number }[],
  policy: Kernel["policy"],
  textLen: number,
): { valid: { type: string; args: Record<string, unknown>; at: number }[]; dropped: number } {
  const valid: { type: string; args: Record<string, unknown>; at: number }[] = [];
  let dropped = 0;
  for (const c of raw) {
    const at = c.at ?? 0;
    if (at < 0 || at > textLen) {
      dropped++;
      continue;
    }
    const schema = cueSchemaForType(policy, c.type);
    if (!schema) {
      dropped++;
      continue;
    }
    const parsed = schema.safeParse(c);
    if (!parsed.success) {
      dropped++;
      continue;
    }
    const v = parsed.data as { type: string; args: Record<string, unknown>; at?: number };
    valid.push({ type: v.type, args: v.args, at: v.at ?? at });
  }
  valid.sort((a, b) => a.at - b.at || a.type.localeCompare(b.type));
  return { valid, dropped };
}

function filterChoices(
  k: Kernel,
  speaker: string,
  addressee: string,
  appraisal: RenderInput["appraisal"],
  raw: { text: string; expected_event_type: string; tags: string[] }[],
  tier: RenderInput["tier"],
): { kept: Choice[]; drafts: EventDraft[] } {
  const drafts: EventDraft[] = [];
  const kept: Choice[] = [];
  let idx = 0;
  for (const c of raw) {
    const ctx = k.celContext({
      self: speaker as import("../types.ts").CharacterId,
      other: addressee as import("../types.ts").CharacterId,
      event: appraisal,
      extra: { choice: c, ...modelCelExtra(k, tier) },
    });
    const ok = k.rules.cel.bool(k.policy.choices.filter, ctx);
    if (!ok) {
      drafts.push({
        kind: "choice.filtered",
        source: "pipeline:render",
        text: c.text,
        expected_event_type: c.expected_event_type,
        tags: c.tags,
      });
      continue;
    }
    idx += 1;
    kept.push({
      id: `c${idx}`,
      text: c.text,
      expected_event_type: c.expected_event_type,
      tags: c.tags ?? [],
    });
    if (kept.length >= k.policy.choices.count) break;
  }
  if (kept.length) {
    drafts.unshift({
      kind: "choice.offered",
      source: "pipeline:render",
      speaker,
      choices: kept,
    });
  }
  return { kept, drafts };
}

async function runRenderStream(
  k: Kernel,
  t: TurnCtx,
  i: RenderInput,
  hits: RetrievalHit[],
  bufferText: boolean,
): Promise<{
  parts: RenderPart[];
  final: { text: string; cues: { type: string; args: Record<string, unknown>; at?: number }[]; intent_realized: string; choices?: { text: string; expected_event_type: string; tags: string[] }[] };
  usage?: import("../types.ts").Usage;
}> {
  const segments = buildPromptSegments(k, {
    purpose: "render",
    speaker: i.speaker,
    addressee: i.addressee,
    scene: i.scene,
    history: i.history,
    fieldEffects: i.fieldEffects,
    tier: i.tier,
    intent: i.intent,
    appraisal: i.appraisal,
    hits,
    sidenotes: i.sidenotes,
    tracks: i.tracks,
    tiers: i.tiers,
    extraDynamic: i.extraDynamic,
    outputLocale: t.outputLocale,
  });

  const schema = buildRenderSchema(k.policy);
  const model = i.tier === "s2" ? k.models.s2 : k.models.s1;
  const tools = i.tier === "s2" ? buildS2Tools(k, i.speaker) : undefined;

  const parts: RenderPart[] = [];
  let prevText = "";
  let longestPartialText = "";
  let finalValue: Record<string, unknown> | undefined;
  let usage: import("../types.ts").Usage | undefined;

  try {
    for await (const chunk of model.stream({
      label: "render",
      segments,
      schema,
      tools,
      maxSteps: i.tier === "s2" ? 3 : undefined,
      maxOutputTokens: routerBudgetK(k).maxOutputTokens[i.tier],
      temperature: k.policy.render.temperature,
      seed: k.authored.config.seed,
      recordingLocales: {
        promptLocale: k.i18n.promptLocale,
        outputLocale: t.outputLocale ?? k.i18n.outputLocale,
        contentLocale: k.i18n.contentLocale,
      },
    })) {
      if (chunk.type === "tool") {
        parts.push({ type: "tool", name: chunk.name, input: chunk.input, output: chunk.output });
      } else if (chunk.type === "partial") {
        const v = chunk.value as { text?: string };
        const next = v.text ?? "";
        if (next.length > longestPartialText.length) longestPartialText = next;
        const delta = textDelta(prevText, next);
        if (delta && !bufferText) parts.push({ type: "text", text: delta });
        prevText = next;
      } else if (chunk.type === "final") {
        finalValue = chunk.value as Record<string, unknown>;
        usage = chunk.usage;
      }
    }
  } catch (err) {
    throw new AnimaeError("RENDER_FAILED", "Render model call failed", err);
  }

  if (!finalValue) throw new AnimaeError("RENDER_FAILED", "Render stream ended without final value");

  const text = String(finalValue.text ?? "").trim() || longestPartialText.trim();
  // Never commit a blank utterance (it would also be written to memory); the turn fails and the player can resend.
  if (!text) throw new AnimaeError("RENDER_FAILED", "Render model returned no text");
  const intent_realized = String(finalValue.intent_realized ?? "");
  const cues = (finalValue.cues as { type: string; args: Record<string, unknown>; at?: number }[]) ?? [];
  const choices = finalValue.choices as { text: string; expected_event_type: string; tags: string[] }[] | undefined;

  if (bufferText && text) parts.push({ type: "text", text });

  return { parts, final: { text, cues, intent_realized, choices }, usage };
}

function emitCuesAfterText(parts: RenderPart[], cues: { type: string; args: Record<string, unknown>; at: number }[]): RenderPart[] {
  const out = [...parts];
  for (const c of cues) {
    out.push({ type: "cue", cue: { type: c.type, args: c.args }, at: c.at });
  }
  return out;
}

export async function* renderStage(k: Kernel, t: TurnCtx, i: RenderInput): AsyncGenerator<RenderPart, RenderResult> {
  const hits = await resolveHits(k, i, t);
  const retryOnMismatch = k.policy.render.retryOnMismatch === 1;
  const bufferFirst = retryOnMismatch;

  let retried = false;
  let stream = await runRenderStream(k, t, i, hits, bufferFirst);
  let { final } = stream;
  let intentOk = final.intent_realized === i.intent.intent;

  if (!intentOk && retryOnMismatch) {
    retried = true;
    stream = await runRenderStream(
      k,
      t,
      {
        ...i,
        extraDynamic: lines(
          i.extraDynamic,
          `You must realize intent "${i.intent.intent}" — previous intent_realized was wrong.`,
        ),
      },
      hits,
      false,
    );
    final = stream.final;
    intentOk = final.intent_realized === i.intent.intent;
  }

  const { valid: cues } = validateCues(final.cues, k.policy, final.text.length);
  let parts = stream.parts;
  if (bufferFirst && !retried) {
    parts = parts.filter((p) => p.type !== "text");
    if (final.text) parts.unshift({ type: "text", text: final.text });
  }
  parts = emitCuesAfterText(parts, cues);

  for (const p of parts) yield p;

  const choiceDrafts: EventDraft[] = [];
  let choices: Choice[] = [];
  if (k.policy.choices.enabled && final.choices?.length) {
    const filtered = filterChoices(k, i.speaker, i.addressee, i.appraisal, final.choices, i.tier);
    choices = filtered.kept;
    choiceDrafts.push(...filtered.drafts);
  }

  let mismatchDraft: EventDraft | undefined;
  if (!intentOk) {
    mismatchDraft = {
      kind: "intent.mismatch",
      source: "pipeline:render",
      owner: i.speaker,
      decided: i.intent.intent,
      realized: final.intent_realized,
    };
  }

  return {
    text: final.text,
    cues,
    intent_realized: final.intent_realized,
    choices,
    choiceDrafts,
    mismatch: !intentOk,
    mismatchDraft,
    tier: i.tier,
    retried,
    hits,
    usage: stream.usage,
  };
}

function lines(...parts: (string | undefined)[]): string {
  return parts.filter(Boolean).join("\n\n");
}
