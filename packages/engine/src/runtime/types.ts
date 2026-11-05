/**
 * Runtime mode types (shared by events, router, model layer and hosts). CONTRACT file.
 *
 * S1 and S2 are *roles*, not models:
 *  - S1: structured-judgment interface (prompt + JSON schema in, schema-conformant data out; never free text).
 *  - S2: free-text generation, with one or more tiers (`models.s2.tiers[]`).
 * Each role is served by a backend: `llm` (a model port) or `rule` (deterministic, token-free).
 */

export type Backend = "llm" | "rule";

/** Which backend serves each role right now. */
export interface RuntimeMode {
  /** Backend of the S1 role: appraise, classify, safety, reflection, entity generation, structured memory writes. */
  appraise: Backend;
  /** Backend of the S2 role: render, offscreen narration, autonomous dialogue. */
  render: Backend;
  /** Tier id used for sync renders when `render` is `llm`; defaults to `models.s2.routing.render` / `models.s2.default`. */
  s2Tier?: string;
}

/** Named combinations of `RuntimeMode` (CLI `--mode`, `:mode`, RPC `runtime.setMode`). */
export type RuntimeModePreset = "full" | "judge-only" | "narrate-only" | "rule";

export const RUNTIME_MODE_PRESETS: readonly RuntimeModePreset[] = ["full", "judge-only", "narrate-only", "rule"];

export const RUNTIME_MODE_PRESET_VALUES: Readonly<Record<RuntimeModePreset, RuntimeMode>> = {
  full: { appraise: "llm", render: "llm" },
  "judge-only": { appraise: "llm", render: "rule" },
  "narrate-only": { appraise: "rule", render: "llm" },
  rule: { appraise: "rule", render: "rule" },
};

/** Name of the preset a mode matches (ignoring `s2Tier`). */
export function runtimeModePresetOf(mode: Pick<RuntimeMode, "appraise" | "render">): RuntimeModePreset {
  if (mode.appraise === "llm") return mode.render === "llm" ? "full" : "judge-only";
  return mode.render === "llm" ? "narrate-only" : "rule";
}

export function isRuntimeModePreset(v: unknown): v is RuntimeModePreset {
  return typeof v === "string" && (RUNTIME_MODE_PRESETS as readonly string[]).includes(v);
}

/** Why the runtime mode changed (`runtime.mode_changed.reason`). */
export type ModeChangeReason = "api" | "config" | "budget" | "fallback" | "cli";

/** Where an LLM call degraded to the rule backend (`runtime.fallback_used.phase`). */
export type FallbackPhase =
  | "appraise"
  | "render"
  | "reflection"
  | "entity"
  | "memory_write"
  | "offscreen"
  | "autonomous";

export const FALLBACK_PHASES: readonly FallbackPhase[] = [
  "appraise",
  "render",
  "reflection",
  "entity",
  "memory_write",
  "offscreen",
  "autonomous",
];

/** When a requested mode change takes effect. */
export type SwitchAt = "turn_boundary" | "immediate";

/** How the S1 role was served for one turn (`route.decided.appraise`). */
export type AppraiseBinding = { backend: "llm"; slot: "s1"; model: string } | { backend: "rule" };

/** How the S2 role was served for one render (`route.decided.render`). */
export type RenderBinding = { backend: "llm"; slot: "s2"; tier: string; model: string } | { backend: "rule" };

/** One S2 tier as configured (`models.s2.tiers[]`). */
export interface S2TierInfo {
  id: string;
  /** Model port id (for example `anthropic/claude-sonnet-4-5`). */
  model: string;
  tags: readonly string[];
}

/** Resolved model landscape, safe to show in UIs (`Engine.info().models`, RPC `runtime.mode`). */
export interface ModelsInfo {
  /** S1 model id, or `rule` when no LLM serves the role. */
  s1: string;
  /** Model id of the default S2 tier, or `rule` when no LLM serves the role. */
  s2: string;
  /** Whether an LLM can serve the S1 role. */
  s1Llm: boolean;
  /** All S2 tiers in configured order (cheapest first by convention); empty when no LLM serves the role. */
  s2Tiers: S2TierInfo[];
  /** Tier used for sync renders by default. */
  s2Default?: string;
  /** Tier the router escalates to when a trigger fires. */
  s2Escalate?: string;
}

/** What a mode switch request is allowed to ask for. */
export interface RuntimeModeRequest {
  appraise?: Backend;
  render?: Backend;
  s2Tier?: string;
}

/** Outcome of `Engine.runtime.setMode`. */
export interface RuntimeModeChange {
  before: RuntimeMode;
  after: RuntimeMode;
  /** `true` when the request was queued behind a running turn and takes effect at the next turn boundary. */
  pending: boolean;
}

/** Options of a mode switch. */
export interface SetModeOptions {
  /** Why the mode changes; written to `runtime.mode_changed.reason`. Default `api`. */
  reason?: ModeChangeReason;
  /** Who asked, for example `cli:--mode`; written to `runtime.mode_changed.trigger`. */
  trigger?: string;
}

/** The part of the mode controller that embedders (`Engine.runtime`) use. */
export interface EngineRuntime {
  /** The mode new turns start under (a queued change is not applied yet). */
  mode(): RuntimeMode;
  /** The mode that will apply at the next turn boundary, or `null`. */
  pending(): RuntimeMode | null;
  /** When requested changes take effect (`runtime.switchAt`). */
  readonly switchAt: SwitchAt;
  /**
   * Switch which backend serves each role. A preset name or a partial mode; omitted roles keep their backend.
   * Under `turn_boundary` the change is queued while a turn is in flight and applies right after it; otherwise it
   * applies at once. Rejects with `MODE_UNAVAILABLE` when a role has no model to switch to.
   */
  setMode(req: RuntimeModeRequest | RuntimeModePreset, opts?: SetModeOptions): Promise<RuntimeModeChange>;
  /** The configured model landscape (S1 model, S2 tiers, routing). */
  models(): ModelsInfo;
}

/** What the turn pipeline and side jobs need from the mode controller on top of `EngineRuntime`. */
export interface RuntimeControl extends EngineRuntime {
  /** Start of a turn: applies a queued change first, returns the mode snapshot the turn runs under. */
  beginTurn(): Promise<RuntimeMode>;
  /** End of a turn (success or failure): applies a queued change once no turn is in flight. */
  endTurn(): Promise<void>;
  /** Whether a failed LLM call of this phase is served by the rule backend (`runtime.fallbackOnError`). */
  fallbackEnabled(phase: FallbackPhase): boolean;
}
