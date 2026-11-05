import type { AppraiseBinding, FallbackPhase, RenderBinding, RuntimeMode } from "../runtime/types.ts";
import type { EngineEvent, TurnId } from "../types.ts";

/** How one recorded turn was served, read back from its events. */
export interface ReplayTurn {
  turn: TurnId;
  /** The mode in force when the turn began (tracked from `runtime.mode_changed`); `null` before any was recorded. */
  mode: RuntimeMode | null;
  /** Authoritative for the turn: what `route.decided` says served the S1 role (`null` when the turn never routed). */
  appraise: AppraiseBinding | null;
  /** Authoritative for the turn: what `route.decided` says served the render. */
  render: RenderBinding | null;
  /** LLM calls the rule backend took over during the turn (`runtime.fallback_used`). */
  fallbacks: { phase: FallbackPhase; code: string }[];
  /** Recording keys of the model calls that served the turn, in event order. */
  recordings: { event: "appraisal" | "utterance"; key: string }[];
}

export interface ReplayPlan {
  turns: ReplayTurn[];
}

/**
 * The backend plan of a recorded run. `route.decided` decides per turn, whatever the engine's current mode is, so a
 * replay never guesses: LLM turns need their recordings, rule turns need nothing and re-derive deterministically.
 */
export function replayPlan(events: readonly EngineEvent[]): ReplayPlan {
  let mode: RuntimeMode | null = null;
  const turns = new Map<TurnId, ReplayTurn>();
  const ensure = (turn: TurnId): ReplayTurn => {
    let t = turns.get(turn);
    if (!t) {
      t = { turn, mode, appraise: null, render: null, fallbacks: [], recordings: [] };
      turns.set(turn, t);
    }
    return t;
  };

  for (const e of events) {
    if (e.kind === "runtime.mode_changed") {
      mode = (e as { after?: RuntimeMode }).after ?? mode;
      continue;
    }
    if (!e.turn) continue;
    const t = ensure(e.turn);
    switch (e.kind) {
      case "route.decided": {
        const r = e as { appraise?: AppraiseBinding; render?: RenderBinding };
        t.appraise = r.appraise ?? t.appraise;
        t.render = r.render ?? t.render;
        break;
      }
      case "runtime.fallback_used": {
        const f = e as { phase?: FallbackPhase; error?: { code?: string } };
        if (f.phase) t.fallbacks.push({ phase: f.phase, code: f.error?.code ?? "error" });
        break;
      }
      case "appraisal":
      case "utterance": {
        const key = (e as { recording?: string }).recording;
        if (key) t.recordings.push({ event: e.kind, key });
        break;
      }
      default:
        break;
    }
  }
  return { turns: [...turns.values()] };
}

/**
 * Recording keys an LLM-served turn needs but the store does not have. Rule turns and turns whose recordings were not
 * kept (the run was live) contribute nothing.
 */
export function missingRecordings(plan: ReplayPlan, has: (key: string) => boolean): { turn: TurnId; key: string }[] {
  const missing: { turn: TurnId; key: string }[] = [];
  for (const t of plan.turns) {
    for (const r of t.recordings) {
      const binding = r.event === "appraisal" ? t.appraise : t.render;
      if (binding?.backend !== "llm") continue;
      if (!has(r.key)) missing.push({ turn: t.turn, key: r.key });
    }
  }
  return missing;
}
