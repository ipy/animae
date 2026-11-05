import type { Kernel, RetrievalHit, TurnCtx } from "../contracts.ts";
import type { ToolDef } from "../ports.ts";
import type { Choice, EventDraft, NarrationStyle, Usage } from "../types.ts";
import { AnimaeError } from "../types.ts";
import { z } from "zod";
import { descriptorToZod } from "../entities/descriptor.ts";
import { recordingKey } from "../model/recording-key.ts";
import { modelErrorContext, ruleModelOf, s2PortFor, s2SpecOf, tiersOf } from "../model/select.ts";
import { locationVar } from "../rule-backend/location.ts";
import { resolveModelTimeoutMs } from "../model/timeout.ts";
import { getPromptSection } from "../prompts/index.ts";
import { s2MaxOutputTokens } from "../router/policy-access.ts";
import { fallbackDraft, fallbackEnabled, isFallbackEligible } from "../runtime/fallback.ts";
import type { RenderBinding } from "../runtime/types.ts";
import { buildCallContext, EMPTY_SEGMENTS } from "./call-context.ts";
import { modelCelExtra, selectorOfRender } from "./model-cel.ts";
import { rethrowPipelineModelError } from "./model-error.ts";
import { buildPromptSegments } from "./prompt.ts";
import { buildRenderSchema } from "./schemas.ts";
import type { RenderInput, RenderPart, RenderResult } from "./types.ts";

type LlmBinding = Extract<RenderBinding, { backend: "llm" }>;

interface RawChoice {
  text: string;
  expected_event_type: string;
  tags: string[];
  intensity?: number;
  sincerity?: number;
  approach?: string;
}

interface RawCue {
  type: string;
  args: Record<string, unknown>;
  at?: number;
}

/** A render answer in the shape both backends produce (the rule backend goes through the same schema). */
interface RenderFinal {
  text: string;
  narrations: { text: string; style: NarrationStyle }[];
  cues: RawCue[];
  intent_realized: string;
  choices?: RawChoice[];
}

/** What has already been yielded to the consumer: what a `reset` would have to take back. */
interface Emitted {
  text: string;
  narrations: string[];
  any: boolean;
}

function freshEmitted(): Emitted {
  return { text: "", narrations: [], any: false };
}

function textDelta(prev: string, next: string): string | null {
  if (next === prev) return null;
  if (next.startsWith(prev)) return next.slice(prev.length);
  return null;
}

function styleOf(raw: unknown): NarrationStyle {
  return raw === "scene_break" ? "scene_break" : "normal";
}

async function resolveHits(k: Kernel, i: RenderInput, t: TurnCtx, binding: LlmBinding): Promise<RetrievalHit[]> {
  if (i.hits && i.hits.length > 0) return i.hits;
  const ctx = k.celContext({
    self: i.speaker,
    other: i.addressee,
    event: i.appraisal,
    sceneId: i.scene.id,
    extra: modelCelExtra(k, selectorOfRender(binding)),
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

/** The tools an S2 render may call to search and read memory and knowledge. */
export function buildS2Tools(k: Kernel, speaker: string, tier?: string): ToolDef[] {
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
          extra: modelCelExtra(k, { kind: "s2", ...(tier !== undefined ? { tier } : {}) }),
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
  raw: RawCue[],
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
  raw: RawChoice[],
  binding: RenderBinding,
): { kept: Choice[]; drafts: EventDraft[] } {
  const drafts: EventDraft[] = [];
  const kept: Choice[] = [];
  let idx = 0;
  for (const c of raw) {
    const ctx = k.celContext({
      self: speaker as import("../types.ts").CharacterId,
      other: addressee as import("../types.ts").CharacterId,
      event: appraisal,
      extra: { choice: c, ...modelCelExtra(k, selectorOfRender(binding)) },
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
      ...(c.intensity !== undefined ? { intensity: c.intensity } : {}),
      ...(c.sincerity !== undefined ? { sincerity: c.sincerity } : {}),
      ...(c.approach ? { approach: c.approach } : {}),
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

function readFinal(value: Record<string, unknown>, longestPartialText: string): RenderFinal {
  const text = String(value.text ?? "").trim() || longestPartialText.trim();
  // Never commit a blank utterance (it would also be written to memory); the turn fails and the player can resend.
  if (!text) throw new AnimaeError("MODEL_EMPTY", "Render model returned no text");
  const narrations: RenderFinal["narrations"] = [];
  if (Array.isArray(value.narrations)) {
    for (const n of value.narrations as { text?: unknown; style?: unknown }[]) {
      const body = typeof n?.text === "string" ? n.text.trim() : "";
      if (body) narrations.push({ text: body, style: styleOf(n.style) });
    }
  }
  return {
    text,
    narrations,
    cues: (value.cues as RawCue[] | undefined) ?? [],
    intent_realized: String(value.intent_realized ?? ""),
    choices: value.choices as RawChoice[] | undefined,
  };
}

/** Live deltas of the narration paragraphs a streaming model has written so far. */
function* narrationDeltas(raw: unknown, emitted: Emitted): Generator<RenderPart> {
  if (!Array.isArray(raw)) return;
  for (let idx = 0; idx < raw.length; idx++) {
    const item = raw[idx] as { style?: unknown; text?: unknown } | null;
    if (!item || typeof item !== "object") break;
    // `style` is written before `text`: a paragraph is shown once its style is known (or once a later one proves it done)
    if (typeof item.style !== "string" && idx === raw.length - 1) break;
    const text = typeof item.text === "string" ? item.text : "";
    const prev = emitted.narrations[idx] ?? "";
    if (text.length <= prev.length || !text.startsWith(prev)) continue;
    emitted.narrations[idx] = text;
    emitted.any = true;
    yield {
      type: "narration",
      text: text.slice(prev.length),
      style: styleOf(item.style),
      ...(prev === "" ? { newParagraph: true } : {}),
    };
  }
}

/** Whatever of the final answer the consumer has not been shown yet: narrations first, then the utterance. */
function* flushRemaining(final: RenderFinal, emitted: Emitted): Generator<RenderPart> {
  for (const [idx, n] of final.narrations.entries()) {
    const prev = emitted.narrations[idx] ?? "";
    if (prev === n.text) continue;
    if (prev === "") {
      yield { type: "narration", text: n.text, style: n.style, newParagraph: true };
    } else if (n.text.startsWith(prev)) {
      yield { type: "narration", text: n.text.slice(prev.length), style: n.style };
    }
    emitted.narrations[idx] = n.text;
  }
  if (emitted.text === "") {
    yield { type: "text", text: final.text };
  } else if (final.text.startsWith(emitted.text) && final.text.length > emitted.text.length) {
    yield { type: "text", text: final.text.slice(emitted.text.length) };
  }
  emitted.text = final.text;
  emitted.any = true;
}

interface LlmOutcome {
  final: RenderFinal;
  usage?: Usage;
  recording?: string;
}

/**
 * One streaming S2 call. Unless `buffer` is set, text and narration deltas are yielded as the model writes them; the
 * caller finishes with `flushRemaining` for whatever never streamed.
 */
async function* streamLlm(
  k: Kernel,
  t: TurnCtx,
  i: RenderInput,
  binding: LlmBinding,
  hits: RetrievalHit[],
  buffer: boolean,
  emitted: Emitted,
): AsyncGenerator<RenderPart, LlmOutcome> {
  const segments = buildPromptSegments(k, {
    purpose: "render",
    speaker: i.speaker,
    addressee: i.addressee,
    scene: i.scene,
    history: i.history,
    fieldEffects: i.fieldEffects,
    tier: binding.tier,
    escalated: i.escalated === true,
    intent: i.intent,
    appraisal: i.appraisal,
    playerText: i.input?.text ?? "",
    hits,
    sidenotes: i.sidenotes,
    tracks: i.tracks,
    tiers: i.tiers,
    extraStatic: i.extraStatic,
    extraDynamic: i.extraDynamic,
    outputLocale: t.outputLocale,
  });

  const schema = buildRenderSchema(k.policy);
  const port = s2PortFor(k, binding);
  const tools = buildS2Tools(k, i.speaker, binding.tier);
  const req = {
    label: "render",
    purpose: (t.autonomous ? "autonomous" : "render") as "autonomous" | "render",
    segments,
    schema,
    tools,
    maxSteps: 3,
    maxOutputTokens: s2MaxOutputTokens(k.policy, binding.tier),
    temperature: k.policy.render.temperature,
    seed: k.authored.config.seed,
    recordingLocales: {
      promptLocale: k.i18n.promptLocale,
      outputLocale: t.outputLocale ?? k.i18n.outputLocale,
      contentLocale: k.i18n.contentLocale,
    },
  };
  const recording = (k.timeline.recordings?.mode ?? "live") !== "live" ? recordingKey(port.id, req) : undefined;

  let longestPartialText = "";
  let finalValue: Record<string, unknown> | undefined;
  let usage: Usage | undefined;

  try {
    for await (const chunk of port.stream(req)) {
      if (chunk.type === "tool") {
        yield { type: "tool", name: chunk.name, input: chunk.input, output: chunk.output };
      } else if (chunk.type === "partial") {
        const v = chunk.value as { text?: unknown; narrations?: unknown };
        const next = typeof v.text === "string" ? v.text : "";
        if (next.length > longestPartialText.length) longestPartialText = next;
        if (buffer) continue;
        yield* narrationDeltas(v.narrations, emitted);
        const delta = textDelta(emitted.text, next);
        if (delta) {
          emitted.text = next;
          emitted.any = true;
          yield { type: "text", text: delta };
        }
      } else if (chunk.type === "final") {
        finalValue = chunk.value as Record<string, unknown>;
        usage = chunk.usage;
      }
    }
  } catch (err) {
    rethrowPipelineModelError(
      err,
      "RENDER_FAILED",
      "Render model call failed",
      modelErrorContext(s2SpecOf(k, binding.tier), resolveModelTimeoutMs),
    );
  }

  if (!finalValue) {
    throw new AnimaeError("MODEL_EMPTY", "Render stream ended without final value");
  }
  return { final: readFinal(finalValue, longestPartialText), usage, ...(recording ? { recording } : {}) };
}

/** The render as the rule backend writes it: the same stream interface, a single final value, no tokens. */
async function ruleRender(k: Kernel, t: TurnCtx, i: RenderInput): Promise<RenderFinal> {
  const purpose = t.autonomous ? "autonomous" : "render";
  const schema = buildRenderSchema(k.policy);
  const context = buildCallContext(k, {
    purpose,
    self: i.speaker,
    other: i.addressee,
    actor: t.actor,
    event: i.appraisal,
    sceneId: i.scene.id,
    intent: i.intent,
    ...(i.input ? { input: i.input } : {}),
    inputEventId: i.inputEventId,
    turn: t,
    extra: { location: locationVar(k, i.scene.location) },
  });
  let value: Record<string, unknown> | undefined;
  for await (const part of ruleModelOf(k).stream({
    label: "render",
    purpose,
    segments: EMPTY_SEGMENTS,
    schema,
    maxOutputTokens: s2MaxOutputTokens(k.policy, tiersOf(k).defaultId),
    context,
  })) {
    if (part.type === "final") value = part.value as Record<string, unknown>;
  }
  if (!value) throw new AnimaeError("MODEL_EMPTY", "Rule render produced no value");
  return readFinal(value, "");
}

export async function* renderStage(k: Kernel, t: TurnCtx, i: RenderInput): AsyncGenerator<RenderPart, RenderResult> {
  const emitted = freshEmitted();
  const phase = t.autonomous ? "autonomous" : "render";

  let final: RenderFinal | undefined;
  let usage: Usage | undefined;
  let recording: string | undefined;
  let binding: RenderBinding = i.binding;
  let hits: RetrievalHit[] = [];
  let retried = false;
  let intentOk = true;
  let fallback: EventDraft | undefined;

  if (i.binding.backend === "llm") {
    const llm = i.binding;
    try {
      hits = await resolveHits(k, i, t, llm);
      const retryOnMismatch = k.policy.render.retryOnMismatch === 1;
      // With a retry in reserve the first answer is held back: a wrong intent must never reach the consumer.
      let out = yield* streamLlm(k, t, i, llm, hits, retryOnMismatch, emitted);
      intentOk = out.final.intent_realized === i.intent.intent;
      if (!intentOk && retryOnMismatch) {
        retried = true;
        out = yield* streamLlm(
          k,
          t,
          {
            ...i,
            extraDynamic: lines(
              i.extraDynamic,
              `You must realize intent "${i.intent.intent}" — previous intent_realized was wrong.`,
            ),
          },
          llm,
          hits,
          false,
          emitted,
        );
        intentOk = out.final.intent_realized === i.intent.intent;
      }
      final = out.final;
      usage = out.usage;
      recording = out.recording;
    } catch (err) {
      if (!fallbackEnabled(k, phase) || !isFallbackEligible(err)) throw err;
      fallback = fallbackDraft(phase, err, "pipeline:render");
      // Whatever already reached the consumer belongs to a render that no longer exists.
      if (emitted.any) yield { type: "reset", reason: "fallback" };
      emitted.text = "";
      emitted.narrations = [];
      emitted.any = false;
      binding = { backend: "rule" };
      hits = [];
      intentOk = true;
    }
  } else {
    binding = { backend: "rule" };
  }

  if (!final) {
    final = await ruleRender(k, t, i);
    intentOk = true;
  }

  yield* flushRemaining(final, emitted);

  const { valid: cues } = validateCues(final.cues, k.policy, final.text.length);
  for (const c of cues) yield { type: "cue", cue: { type: c.type, args: c.args }, at: c.at };

  const choiceDrafts: EventDraft[] = [];
  let choices: Choice[] = [];
  if (k.policy.choices.enabled && final.choices?.length) {
    const filtered = filterChoices(k, i.speaker, i.addressee, i.appraisal, final.choices, binding);
    choices = filtered.kept;
    choiceDrafts.push(...filtered.drafts);
  }

  // The rule backend states the intent it realized by construction; a mismatch is only ever an LLM finding.
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
    narrations: final.narrations,
    cues,
    intent_realized: final.intent_realized,
    choices,
    choiceDrafts,
    mismatch: !intentOk,
    mismatchDraft,
    binding,
    ...(fallback ? { fallbackDraft: fallback } : {}),
    ...(recording ? { recording } : {}),
    retried,
    hits,
    usage,
  };
}

function lines(...parts: (string | undefined)[]): string {
  return parts.filter(Boolean).join("\n\n");
}
