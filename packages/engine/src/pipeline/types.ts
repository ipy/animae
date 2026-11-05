import type { TurnCtx, Kernel, RetrievalHit } from "../contracts.ts";
import type { Appraisal } from "../events.ts";
import type { FieldEffects } from "../schema/authored.ts";
import type { Choice, EventDraft, NarrationStyle, SceneId, TurnId, TurnResetReason, Usage, CharacterId } from "../types.ts";
import type { AppraiseBinding, Backend, RenderBinding } from "../runtime/types.ts";

/** Scene snapshot passed into prompt/appraise/render (built by run-turn). */
export interface SceneInfo {
  id: SceneId;
  location: string;
  locationDescription?: string;
  participants: CharacterId[];
  turn: number;
  firstTurn: boolean;
}

/** One line of recent dialogue for prompt history (oldest first within the slice). */
export interface TurnHistoryLine {
  turnId?: TurnId;
  role: "user" | "assistant";
  speaker?: CharacterId;
  content: string;
}

/** Shared prompt builder input (appraise + render). */
export interface PromptInput {
  purpose: "appraise" | "render";
  speaker: CharacterId;
  addressee: CharacterId;
  scene: SceneInfo;
  history: TurnHistoryLine[];
  /** Merged field effects for the speaking NPC (L0–L4). */
  fieldEffects: FieldEffects;
  /** S2 tier id of an LLM render (absent for appraise); gates the S2-only prompt parts (tools, knowledge index). */
  tier?: string;
  /** The render runs on the escalation tier: the length hint asks for a richer beat. */
  escalated?: boolean;
  intent?: { intent: string; scores: Record<string, number>; forced?: boolean };
  appraisal?: Appraisal;
  /** Pre-retrieved hits for dynamic segment; render may fill if omitted. */
  hits?: RetrievalHit[];
  sidenotes?: { noteId: string; text: string; verbatim: boolean }[];
  tracks?: Record<string, number>;
  tiers?: Record<string, string | null>;
  /** Current actor utterance (appraise user message). */
  actorText?: string;
  /** Player line for this turn (render): CEL `event.text` for knowledge `when` and rules. */
  playerText?: string;
  /** Extra instructions that stay the same from turn to turn: part of the static (cacheable) segment. */
  extraStatic?: string;
  /** Extra dynamic instructions (e.g. mismatch retry). */
  extraDynamic?: string;
  /** Per-turn player-facing generation language (defaults to engine `outputLocale`). */
  outputLocale?: string;
}

/** Appraise stage input beyond `Kernel` + `TurnCtx`. */
export interface AppraiseInput {
  speaker: CharacterId;
  addressee: CharacterId;
  actor: CharacterId;
  actorText: string;
  choiceId?: string;
  scene: SceneInfo;
  history: TurnHistoryLine[];
  /** L0 salience/topic_access and L4 self-view for the speaker. */
  fieldEffects: FieldEffects;
  /** Backend that serves the S1 role for this turn (default: the engine's current mode). */
  backend?: Backend;
  /** `input.received` event of the turn; seeds the rule backend. */
  inputEventId?: string;
}

export interface AppraiseStageResult {
  appraisal: Appraisal;
  drafts: EventDraft[];
  /** What actually served the appraisal (the rule backend after an LLM failure with fallback enabled). */
  binding: AppraiseBinding;
  /** Present when `policy.safety.enabled` and model returned a non-none category. */
  safety?: { category: Appraisal["safety"]; response: string };
}

/** Render stage input beyond `Kernel` + `TurnCtx`. */
export interface RenderInput {
  /** How the render is served: an S2 tier, or the rule backend. */
  binding: RenderBinding;
  /** The binding is the escalation tier (a trigger fired and the budget allowed it). */
  escalated?: boolean;
  speaker: CharacterId;
  addressee: CharacterId;
  intent: { intent: string; scores: Record<string, number>; forced?: boolean };
  appraisal: Appraisal;
  fieldEffects: FieldEffects;
  scene: SceneInfo;
  history: TurnHistoryLine[];
  /**
   * Retrieval hits for the dynamic segment. When omitted, `renderStage` retrieves via
   * `k.m.memory.retrieve` + `distort` using `appraisal.search_terms` (same as run-turn would).
   */
  hits?: RetrievalHit[];
  sidenotes: { noteId: string; text: string; verbatim: boolean }[];
  tracks?: Record<string, number>;
  tiers?: Record<string, string | null>;
  extraStatic?: string;
  extraDynamic?: string;
  /** `input.received` event of the turn; seeds the rule backend. */
  inputEventId?: string;
  /** The player input of the turn, for the rule backend's templates. */
  input?: { text: string; choiceId?: string };
}

export type RenderPart =
  | { type: "text"; text: string }
  | { type: "narration"; text: string; style: NarrationStyle; newParagraph?: boolean }
  | { type: "cue"; cue: { type: string; args: Record<string, unknown> }; at: number }
  | { type: "tool"; name: string; input: unknown; output: unknown }
  /** Discard what was emitted for the turn so far: the render is being redone on another backend. */
  | { type: "reset"; reason: TurnResetReason };

export interface RenderResult {
  text: string;
  /** Speaker-less paragraphs that precede the utterance. */
  narrations: { text: string; style: NarrationStyle }[];
  cues: { type: string; args: Record<string, unknown>; at: number }[];
  intent_realized: string;
  choices: Choice[];
  /** `choice.offered` / `choice.filtered` drafts from post-filter. */
  choiceDrafts: EventDraft[];
  mismatch: boolean;
  mismatchDraft?: EventDraft;
  /** What served the render (the rule backend after an LLM failure with fallback enabled). */
  binding: RenderBinding;
  /** `runtime.fallback_used` for the LLM call the rule backend took over; append before the render's other events. */
  fallbackDraft?: EventDraft;
  /** Recording key of the S2 call, when the engine records or replays model calls. */
  recording?: string;
  retried: boolean;
  /** Hits used in prompt (for explain). */
  hits: RetrievalHit[];
  usage?: Usage;
}

export type BuildPromptSegments = (k: Kernel, i: PromptInput) => import("../ports.ts").PromptSegments;
export type AppraiseStageFn = (
  k: Kernel,
  t: TurnCtx,
  i: AppraiseInput,
) => Promise<AppraiseStageResult>;
export type RenderStageFn = (
  k: Kernel,
  t: TurnCtx,
  i: RenderInput,
) => AsyncGenerator<RenderPart, RenderResult>;
