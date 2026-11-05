import { AnimaeError, type EventDraft } from "../types.ts";
import {
  RUNTIME_MODE_PRESET_VALUES,
  isRuntimeModePreset,
  type Backend,
  type FallbackPhase,
  type ModeChangeReason,
  type ModelsInfo,
  type RuntimeControl,
  type RuntimeMode,
  type RuntimeModeChange,
  type RuntimeModePreset,
  type RuntimeModeRequest,
  type SetModeOptions,
  type SwitchAt,
} from "./types.ts";

/** `runtime.fallbackOnError` as the controller reads it (one flag per phase). */
export type FallbackFlags = Readonly<Record<FallbackPhase, boolean>>;

export interface ModeControllerOptions {
  /** Mode new turns start under. */
  initial: RuntimeMode;
  /** Why `initial` is what it is; written to the first `runtime.mode_changed` of the timeline. Default `config`. */
  initialReason?: ModeChangeReason;
  initialTrigger?: string;
  switchAt: SwitchAt;
  fallback: FallbackFlags;
  /** Whether a model can serve each role, and the S2 tier ids. Read on every request so hot reload stays correct. */
  available(): { s1: boolean; s2Tiers: readonly string[] };
  models(): ModelsInfo;
  /** The mode the timeline last recorded (`state.runtime.mode`). */
  recordedMode(): RuntimeMode | undefined;
  /** Appends events outside any turn; called only while no turn is in flight. */
  emit(drafts: EventDraft[]): Promise<unknown>;
}

function sameMode(a: RuntimeMode, b: RuntimeMode): boolean {
  return a.appraise === b.appraise && a.render === b.render && (a.s2Tier ?? "") === (b.s2Tier ?? "");
}

function normalize(req: RuntimeModeRequest | RuntimeModePreset, current: RuntimeMode): RuntimeMode {
  if (typeof req === "string") {
    if (!isRuntimeModePreset(req)) {
      throw new AnimaeError("MODE_INVALID", `unknown runtime mode "${String(req)}" (expected full, judge-only, narrate-only or rule)`);
    }
    const preset = RUNTIME_MODE_PRESET_VALUES[req];
    return { appraise: preset.appraise, render: preset.render, ...(current.s2Tier && preset.render === "llm" ? { s2Tier: current.s2Tier } : {}) };
  }
  const backend = (v: Backend | undefined, name: string): Backend | undefined => {
    if (v !== undefined && v !== "llm" && v !== "rule") throw new AnimaeError("MODE_INVALID", `runtime mode ${name} must be "llm" or "rule", got "${String(v)}"`);
    return v;
  };
  const appraise = backend(req.appraise, "appraise") ?? current.appraise;
  const render = backend(req.render, "render") ?? current.render;
  const s2Tier = req.s2Tier ?? current.s2Tier;
  return { appraise, render, ...(render === "llm" && s2Tier ? { s2Tier } : {}) };
}

/**
 * Owns the runtime mode: which backend (`llm` | `rule`) serves the S1 and S2 roles. A change requested while a turn is in
 * flight is queued and applied between turns (`turn_boundary`), so a turn never mixes backends because of a switch; under
 * `immediate` it applies at once. Every applied change is written as `runtime.mode_changed`.
 */
export function createModeController(opts: ModeControllerOptions): RuntimeControl {
  let mode: RuntimeMode = { ...opts.initial };
  let queued: { mode: RuntimeMode; reason: ModeChangeReason; trigger?: string } | null = null;
  let inFlight = 0;
  let announced = false;

  /**
   * `requestedTier` is the tier a request names. It is checked even when the resulting mode renders on rules (where the
   * tier plays no part), so a misspelt tier is never accepted silently.
   */
  function validate(next: RuntimeMode, requestedTier?: string): void {
    const avail = opts.available();
    if (next.appraise === "llm" && !avail.s1) {
      throw new AnimaeError("MODE_UNAVAILABLE", "the S1 role has no model configured; configure `models.s1` to run it on an LLM");
    }
    if (next.render === "llm" && avail.s2Tiers.length === 0) {
      throw new AnimaeError("MODE_UNAVAILABLE", "the S2 role has no model configured; configure `models.s2` to run it on an LLM");
    }
    for (const tier of [next.s2Tier, requestedTier]) {
      if (tier !== undefined && !avail.s2Tiers.includes(tier)) {
        throw new AnimaeError("MODE_UNKNOWN_TIER", `unknown S2 tier "${tier}" (tiers: ${avail.s2Tiers.join(", ") || "none"})`);
      }
    }
  }

  async function apply(next: RuntimeMode, reason: ModeChangeReason, trigger: string | undefined): Promise<RuntimeMode> {
    const before = mode;
    mode = { ...next };
    await opts.emit([
      {
        kind: "runtime.mode_changed",
        source: "runtime",
        before: { ...before },
        after: { ...mode },
        reason,
        ...(trigger ? { trigger } : {}),
      },
    ]);
    announced = true;
    return before;
  }

  /** Writes the mode the engine starts under when the timeline has not recorded it yet (first turn, or a config change). */
  async function announceInitial(): Promise<void> {
    if (announced) return;
    announced = true;
    const recorded = opts.recordedMode();
    if (recorded && sameMode(recorded, mode)) return;
    await opts.emit([
      {
        kind: "runtime.mode_changed",
        source: "runtime",
        before: recorded ? { ...recorded } : null,
        after: { ...mode },
        reason: opts.initialReason ?? "config",
        ...(opts.initialTrigger ? { trigger: opts.initialTrigger } : {}),
      },
    ]);
  }

  return {
    switchAt: opts.switchAt,
    mode: () => ({ ...mode }),
    pending: () => (queued ? { ...queued.mode } : null),
    models: () => opts.models(),
    fallbackEnabled: (phase) => opts.fallback[phase] === true,

    async setMode(req: RuntimeModeRequest | RuntimeModePreset, o: SetModeOptions = {}): Promise<RuntimeModeChange> {
      const base = queued?.mode ?? mode;
      const next = normalize(req, base);
      validate(next, typeof req === "string" ? undefined : req.s2Tier);
      const reason = o.reason ?? "api";
      if (queued && sameMode(next, mode)) {
        // a request that undoes the queued change
        queued = null;
        return { before: { ...mode }, after: { ...mode }, pending: false };
      }
      if (sameMode(next, mode)) return { before: { ...mode }, after: { ...mode }, pending: false };
      if (inFlight > 0 && opts.switchAt === "turn_boundary") {
        queued = { mode: next, reason, trigger: o.trigger };
        return { before: { ...mode }, after: { ...next }, pending: true };
      }
      queued = null;
      await announceInitial();
      const before = await apply(next, reason, o.trigger);
      return { before: { ...before }, after: { ...mode }, pending: false };
    },

    async beginTurn(): Promise<RuntimeMode> {
      if (inFlight === 0 && queued) {
        const q = queued;
        queued = null;
        await announceInitial();
        await apply(q.mode, q.reason, q.trigger);
      }
      await announceInitial();
      inFlight += 1;
      return { ...mode };
    },

    async endTurn(): Promise<void> {
      inFlight = Math.max(0, inFlight - 1);
      if (inFlight === 0 && queued) {
        const q = queued;
        queued = null;
        await apply(q.mode, q.reason, q.trigger);
      }
    },
  };
}
