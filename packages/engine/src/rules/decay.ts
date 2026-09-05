import type { EventDraft, WorldTime } from "../types.ts";
import { hoursBetween } from "../timeline/time.ts";
import type { RulesDeps } from "./deps.ts";
import { decayStep, tierFor } from "./primitives.ts";

export function decayTicks(deps: RulesDeps, from: WorldTime, to: WorldTime): EventDraft[] {
  const hours = hoursBetween(from, to);
  if (hours <= 0) return [];

  const drafts: EventDraft[] = [];
  const { policy, state } = deps;

  for (const [id, ch] of Object.entries(state.characters)) {
    for (const [track, def] of Object.entries(policy.tracks)) {
      const decay = def.decay;
      if (!decay) continue;

      if (def.scope === "self") {
        const before = ch.tracks.self[track] ?? def.initial;
        const afterRaw = decayStep(before, decay, hours);
        const after = Math.round(afterRaw * 100) / 100;
        const delta = Math.round((after - before) * 100) / 100;
        if (Math.abs(delta) < 0.01) continue;
        drafts.push({
          kind: "track.delta",
          owner: id,
          track,
          delta,
          before,
          after,
          reason: "decay",
        });
        const stored = ch.tiers.self[track] ?? null;
        const { tier: newTier, direction } = tierFor(after, def.tiers ?? [], stored, def.hysteresis ?? 0);
        if (direction !== "same" && newTier !== stored) {
          drafts.push({
            kind: "tier.changed",
            owner: id,
            track,
            from: stored,
            to: newTier,
            direction,
          });
        }
      } else {
        for (const [target, tracks] of Object.entries(ch.tracks.toward)) {
          const before = tracks[track] ?? def.initial;
          const afterRaw = decayStep(before, decay, hours);
          const after = Math.round(afterRaw * 100) / 100;
          const delta = Math.round((after - before) * 100) / 100;
          if (Math.abs(delta) < 0.01) continue;
          drafts.push({
            kind: "track.delta",
            owner: id,
            target,
            track,
            delta,
            before,
            after,
            reason: "decay",
          });
          const stored = ch.tiers.toward[target]?.[track] ?? null;
          const { tier: newTier, direction } = tierFor(after, def.tiers ?? [], stored, def.hysteresis ?? 0);
          if (direction !== "same" && newTier !== stored) {
            drafts.push({
              kind: "tier.changed",
              owner: id,
              target,
              track,
              from: stored,
              to: newTier,
              direction,
            });
          }
        }
      }
    }
  }

  return drafts;
}
