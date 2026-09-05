import type { Appraisal, CheckRolled } from "../events.ts";
import type { FieldEffects } from "../schema/authored.ts";
import type { CharacterId, EventDraft, Rng, TurnId } from "../types.ts";
import { worldMinutes } from "../timeline/time.ts";
import { buildCelContext } from "./cel-context.ts";
import type { RulesDeps } from "./deps.ts";
import { applyTurnCap, computeDelta, decayedCounter, marginal, tierFor } from "./primitives.ts";

export interface AdjudicateInput {
  appraisal: Appraisal;
  actor: CharacterId;
  owner: CharacterId;
  turnId: TurnId;
  fieldEffects?: FieldEffects;
  rng: Rng;
  /** Last check from the check stage (same turn), exposed to custom adjudicate rules via CEL `check`. */
  check?: CheckRolled | null;
}

function counterKey(owner: CharacterId, target: CharacterId, eventType: string): string {
  return `${owner}|${target}|${eventType}`;
}

function readTrack(
  state: RulesDeps["state"],
  owner: CharacterId,
  target: CharacterId,
  track: string,
  def: RulesDeps["policy"]["tracks"][string],
  fieldEffects?: FieldEffects,
): number {
  const c = state.characters[owner];
  if (!c) return def.initial;
  let v = def.scope === "self" ? (c.tracks.self[track] ?? def.initial) : (c.tracks.toward[target]?.[track] ?? def.initial);
  const off = fieldEffects?.track_offset?.[track];
  if (typeof off === "number") v += off;
  return v;
}

function trackMult(fieldEffects: FieldEffects | undefined, track: string, eventType: string): number {
  const row = fieldEffects?.track_mult?.[track];
  if (!row) return 1;
  return row[eventType] ?? row["*"] ?? 1;
}

export function adjudicate(
  deps: RulesDeps,
  input: AdjudicateInput,
): { drafts: EventDraft[]; tierChanged: boolean; moodDelta?: number; moodBefore?: number } {
  const drafts: EventDraft[] = [];
  let tierChanged = false;
  const { policy, state } = deps;
  const owner = input.owner;
  const target = input.actor;
  const eventType = input.appraisal.type;
  const row = policy.rules.delta_table?.[eventType];
  if (!row) return { drafts, tierChanged };

  const ctx = buildCelContext(deps, {
    self: owner,
    other: target,
    actor: input.actor,
    event: input.appraisal,
    check: input.check ? ({ ...input.check } as Record<string, unknown>) : null,
  });

  const marginalCfg = policy.rules.marginal ?? { k: 0.5, halfLifeHours: 24 };
  const nowMin = worldMinutes(state.time);
  const ck = counterKey(owner, target, eventType);
  const counter = state.counters[ck];
  const nDecayed = counter
    ? decayedCounter(counter.n, counter.lastMinutes, nowMin, marginalCfg.halfLifeHours)
    : 0;
  const nPrior = Math.max(0, nDecayed - 1);
  const marg = marginal(nPrior, marginalCfg.k);

  const traitMult =
    ((deps.catalog.character(owner)?.traits as { event_mult?: Record<string, number> })?.event_mult?.[eventType] as number | undefined) ?? 1;

  let turnAcc = { ...state.turnAcc.delta };
  if (state.turnAcc.turn !== input.turnId) turnAcc = {};

  let moodBefore: number | undefined;
  let moodDelta: number | undefined;

  for (const [track, base] of Object.entries(row)) {
    const def = policy.tracks[track];
    if (!def) continue;

    const mult = trackMult(input.fieldEffects, track, eventType);
    let delta = computeDelta({
      base,
      intensity: input.appraisal.intensity,
      sincerity: input.appraisal.sincerity,
      sincerityFactor: base > 0 ? input.appraisal.sincerity : 1,
      traitMult,
      marginal: marg,
      trackMult: mult,
    });

    for (const w of policy.rules.windows ?? []) {
      const open = state.windows[w.id];
      if (!open || open.owner !== owner || (open.target ?? "") !== (target ?? "")) continue;
      if (state.sceneCount > open.untilScene) continue;
      const m = w.mult[track];
      if (m !== undefined) delta *= m;
      if (w.capToLoss && delta > 0) delta = 0;
    }

    const cap = policy.rules.turn_cap?.[track];
    const capped = applyTurnCap(delta, track, turnAcc, cap);
    delta = capped.delta;
    turnAcc = capped.acc;

    const before = readTrack(state, owner, target, track, def, input.fieldEffects);
    let after = before + delta;
    if (after < def.min) after = def.min;
    if (after > def.max) after = def.max;
    delta = Math.round((after - before) * 100) / 100;

    if (Math.abs(delta) < 0.005) continue;

    if (track === "mood") {
      moodBefore = before;
      moodDelta = delta;
    }

    drafts.push({
      kind: "track.delta",
      source: "rules:adjudicate",
      owner,
      target: def.scope === "relation" ? target : undefined,
      track,
      delta,
      before,
      after,
      eventType,
      factors: { base, intensity: input.appraisal.intensity, marginal: marg, traitMult, trackMult: mult },
    });

    const storedTier =
      def.scope === "self"
        ? (state.characters[owner]?.tiers.self[track] ?? null)
        : (state.characters[owner]?.tiers.toward[target]?.[track] ?? null);
    const { tier: newTier, direction } = tierFor(after, def.tiers ?? [], storedTier, def.hysteresis ?? 0);
    if (direction !== "same" && newTier !== storedTier) {
      tierChanged = true;
      drafts.push({
        kind: "tier.changed",
        source: "rules:adjudicate",
        owner,
        target: def.scope === "relation" ? target : undefined,
        track,
        from: storedTier,
        to: newTier,
        direction,
      });
    }
  }

  for (const w of policy.rules.windows ?? []) {
    const existing = state.windows[w.id];
    if (existing && existing.untilScene >= state.sceneCount) continue;
    if (!deps.cel.bool(w.trigger, ctx)) continue;
    const untilScene = state.sceneCount + w.durationScenes;
    drafts.push({
      kind: "rule.window_opened",
      id: w.id,
      owner,
      target,
      untilScene,
      durationScenes: w.durationScenes,
    });
  }

  for (const th of policy.rules.thresholds ?? []) {
    if (!deps.cel.bool(th.when, ctx)) continue;
    const fk = `${th.id}|${owner}|${target}`;
    if (!th.repeat && state.firedThresholds[fk]) continue;
    const emit = th.emit;
    const list = Array.isArray(emit) ? emit : [emit];
    drafts.push(...list.map((e) => ({ ...e })));
    drafts.push({ kind: "rule.threshold_fired", id: th.id, owner, target });
  }

  for (const cr of policy.rules.custom ?? []) {
    if (cr.stage !== "adjudicate") continue;
    if (cr.when && !deps.cel.bool(cr.when, ctx)) continue;
    const out = deps.rules.run(cr.fn, {
      stage: "adjudicate",
      state: deps.state,
      authored: deps.authored,
      policy: deps.policy,
      time: deps.state.time,
      vars: ctx,
      rngKey: `${input.turnId}:custom:${cr.id}`,
    });
    drafts.push(...out);
  }

  return { drafts, tierChanged, moodDelta, moodBefore };
}
