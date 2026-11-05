import { z } from "zod";
import type { Kernel, TurnCtx } from "../contracts.ts";
import type { Appraisal } from "../events.ts";
import { entityDisplayName } from "../entities/names.ts";
import { llmRoles, modelErrorContext, ruleModelOf, s1SpecOf } from "../model/select.ts";
import { resolveModelTimeoutMs } from "../model/timeout.ts";
import { buildCallContext, EMPTY_SEGMENTS } from "../pipeline/call-context.ts";
import { rethrowPipelineModelError } from "../pipeline/model-error.ts";
import { displayLanguageName, getPromptSection } from "../prompts/index.ts";
import { routerBudgetK } from "../router/policy-access.ts";
import { withRuleFallback } from "../runtime/fallback.ts";
import type { Backend } from "../runtime/types.ts";
import type { CharacterId, EventId, NarrationStyle, SceneId } from "../types.ts";

/** One structured memory entry: the answer shape of `memory.writing` on both backends. */
export const MemoryWriteSchema = z.strictObject({
  text: z.string().min(1),
  importance: z.number().min(0).max(1),
  valence: z.number().min(-1).max(1),
});
export type MemoryWrite = z.infer<typeof MemoryWriteSchema>;

export interface TurnMemoryInput {
  speaker: CharacterId;
  addressee: CharacterId;
  actor: CharacterId;
  appraisal: Appraisal;
  /** the utterance the speaker just gave */
  text: string;
  moodDelta: number;
  /** event the memory is derived from (the utterance) */
  src?: EventId;
  inputEventId?: string;
  /** backend that served the S1 role this turn: a model writes the memory only when it is `llm` */
  backend: Backend;
}

function unit(n: unknown, lo: number, hi: number, fallback: number): number {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
}

/**
 * The speaker's episodic memory of the turn. `memory.writing.backend: rule` (default) derives the entry from the
 * utterance, the appraised event type and the mood change without a model; `s1` asks the S1 role for a structured
 * summary and falls back to the rule entry when S1 is not on a model or its call fails (with fallback enabled).
 */
export async function writeTurnMemory(k: Kernel, t: TurnCtx, i: TurnMemoryInput): Promise<void> {
  const policy = k.policy.memory.write ?? { episodic: true, minIntensity: 0.2, maxChars: 240 };
  if (!policy.episodic || i.appraisal.intensity < (policy.minIntensity ?? 0)) return;
  const maxChars = policy.maxChars ?? 240;
  const defaultValence = Math.sign(i.moodDelta);

  const callRule = (): Promise<MemoryWrite> =>
    ruleModelOf(k).object({
      label: "memory-write",
      purpose: "memory-write",
      segments: EMPTY_SEGMENTS,
      schema: MemoryWriteSchema,
      maxOutputTokens: 0,
      context: buildCallContext(k, {
        purpose: "memory-write",
        self: i.speaker,
        other: i.addressee,
        actor: i.actor,
        event: i.appraisal,
        sceneId: t.sceneId,
        inputEventId: i.inputEventId,
        turn: t,
        extra: { text: i.text, speaker: i.speaker, defaultValence, maxChars },
      }),
    }) as Promise<MemoryWrite>;

  const callLlm = async (): Promise<MemoryWrite> => {
    const loc = k.i18n.promptLocale;
    const state = k.timeline.state();
    const nameOf = (id: CharacterId) => entityDisplayName(state, k.catalog, id, { viewer: i.speaker });
    const vars = {
      name: nameOf(i.speaker),
      player: nameOf(i.actor),
      maxChars,
      outputLang: displayLanguageName(t.outputLocale ?? k.i18n.outputLocale, loc),
      tag: t.outputLocale ?? k.i18n.outputLocale,
    };
    try {
      const raw = await k.models.s1.object({
        label: "memory-write",
        purpose: "memory-write",
        segments: {
          static: getPromptSection(loc, "memory_write_task", vars),
          semiStatic: "",
          dynamic: "",
          user: getPromptSection(loc, "memory_write_user", {
            ...vars,
            input: t.text,
            reply: i.text,
            eventType: i.appraisal.type,
            intensity: i.appraisal.intensity.toFixed(2),
          }),
        },
        schema: MemoryWriteSchema,
        maxOutputTokens: routerBudgetK(k).maxOutputTokens.s1,
        temperature: k.policy.render.temperature,
        seed: k.authored.config.seed,
        recordingLocales: {
          promptLocale: k.i18n.promptLocale,
          outputLocale: t.outputLocale ?? k.i18n.outputLocale,
          contentLocale: k.i18n.contentLocale,
        },
      });
      return raw as MemoryWrite;
    } catch (err) {
      rethrowPipelineModelError(
        err,
        "MEMORY_WRITE_FAILED",
        "Memory write model call failed",
        modelErrorContext(s1SpecOf(k), resolveModelTimeoutMs),
      );
    }
  };

  const useModel = k.policy.memory.writing?.backend === "s1" && i.backend === "llm" && llmRoles(k).s1;
  const entry = useModel
    ? (await withRuleFallback(k, "memory_write", "memory", callLlm, callRule)).value
    : await callRule();

  await k.m.memory.write(i.speaker, {
    kind: "episodic",
    t: k.timeline.now(),
    text: entry.text.slice(0, maxChars),
    tags: i.appraisal.tags,
    claims: i.appraisal.claims,
    importance: unit(entry.importance, 0, 1, i.appraisal.intensity),
    valence: unit(entry.valence, -1, 1, defaultValence),
    src: i.src,
  });
}

export interface NarrationMemoryItem {
  id: EventId;
  text: string;
  style: NarrationStyle;
}

/**
 * What narration leaves in the characters' memories (`memory.writing.narration`):
 * - `none` (default): nothing; narration is for the player's eyes only.
 * - `inject_belief`: every non-player character in the scene gets a semantic memory of the paragraph, as a fact the
 *   narrator established. Only while the scene has such a character; scene breaks are structure, never memory.
 * - `shareable`: like `inject_belief`, but as shareable episodic memories, so the paragraph spreads like hearsay.
 */
export async function writeNarrationMemory(
  k: Kernel,
  items: readonly NarrationMemoryItem[],
  scope: { sceneId: SceneId },
): Promise<void> {
  const mode = k.policy.memory.writing?.narration ?? "none";
  if (mode === "none" || items.length === 0) return;
  const scene = k.timeline.state().scene;
  if (!scene || scene.id !== scope.sceneId) return;
  const player = k.authored.world.player;
  const witnesses = scene.participants.filter((p) => p !== player);
  if (witnesses.length === 0) return;
  const importance = k.policy.memory.writing?.importanceByEventType.narration ?? 0.4;
  const maxChars = k.policy.memory.write?.maxChars ?? 240;
  for (const item of items) {
    if (item.style === "scene_break") continue;
    for (const owner of witnesses) {
      await k.m.memory.write(owner, {
        kind: mode === "shareable" ? "episodic" : "semantic",
        t: k.timeline.now(),
        text: item.text.slice(0, maxChars),
        tags: mode === "shareable" ? ["narration", "shareable"] : ["narration"],
        claims: [],
        importance,
        valence: 0,
        ...(mode === "shareable" ? { shareable: true } : {}),
        src: item.id,
      });
    }
  }
}
