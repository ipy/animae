import type { Kernel, TurnCtx } from "../contracts.ts";
import type { Appraisal } from "../events.ts";
import type { ModelCallContext, ModelPurpose, PromptSegments } from "../ports.ts";
import type { CelContext, CharacterId, SceneId } from "../types.ts";

/** Segments of a request the rule backend answers: it reads `context`, never the prompt. */
export const EMPTY_SEGMENTS: PromptSegments = Object.freeze({ static: "", semiStatic: "", dynamic: "", user: "" });

export interface CallContextParams {
  purpose: ModelPurpose;
  self?: CharacterId;
  other?: CharacterId;
  actor?: CharacterId;
  event?: Partial<Appraisal> & { type?: string; text?: string };
  sceneId?: SceneId;
  check?: unknown;
  input?: ModelCallContext["input"];
  intent?: ModelCallContext["intent"];
  extra?: Record<string, unknown>;
  /** `input.received` event of the turn: seeds the rule backend together with the scene turn ordinal */
  inputEventId?: string;
  /** distinguishes calls that share a turn (`appraise`, `render`, `memory-write`) */
  rngKey?: string;
  turn?: Pick<TurnCtx, "turnId" | "autonomous" | "outputLocale">;
}

/**
 * The structured inputs of one model call: the CEL variables of the moment (`self`, `other`, `event`, `scene`, ...) plus
 * `input`, `intent` and the call identity, and a deterministic RNG. An LLM port ignores all of it and reads the prompt;
 * the rule backend reads only this, which is what makes the two interchangeable.
 */
export function buildCallContext(k: Kernel, p: CallContextParams): ModelCallContext {
  const vars: CelContext = k.celContext({
    self: p.self,
    other: p.other,
    actor: p.actor,
    event: p.event,
    sceneId: p.sceneId,
    check: p.check,
  });
  const ordinal = k.timeline.state().scene?.turn ?? 0;
  const seedKey = `rule:${p.inputEventId ?? p.turn?.turnId ?? "none"}:${ordinal}:${p.rngKey ?? p.purpose}`;
  const rng = k.timeline.rng(seedKey);
  return {
    ...vars,
    ...(p.input ? { input: p.input } : {}),
    ...(p.intent ? { intent: p.intent } : {}),
    call: {
      ...(p.turn?.turnId ? { turnId: p.turn.turnId } : {}),
      ...(p.inputEventId ? { inputEventId: p.inputEventId } : {}),
      ...(p.turn?.autonomous ? { autonomous: true } : {}),
      outputLocale: p.turn?.outputLocale ?? k.i18n.outputLocale,
    },
    ...(p.extra ? { extra: p.extra } : {}),
    rng: () => rng.next(),
  };
}
