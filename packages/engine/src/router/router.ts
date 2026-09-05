import type { Kernel, RouteInput, Router } from "../contracts.ts";
import type { EventDraft } from "../types.ts";
import {
  applyDegradeList,
  budgetDegradedDraft,
  budgetSnapshot,
  canAffordS2,
  type DegradeFlags,
  type SideJob,
} from "./budget.ts";
import { evaluateTriggers } from "./triggers.ts";

export { detectContradiction } from "./contradiction.ts";

export function createRouter(k: Kernel): Router {
  const flags: DegradeFlags = {
    deferReflection: false,
    skipOffscreenNarrate: false,
    skipAutonomous: false,
  };

  return {
    decide(i: RouteInput) {
      const reasons = evaluateTriggers(i, k.policy);
      const anchorReason = reasons.includes("anchor_near");
      const snap = budgetSnapshot(k, i.turn.sceneId, i.turn.turnId);
      const wantS2 = reasons.length > 0;

      let tier: "s1" | "s2" = wantS2 ? "s2" : "s1";
      const degraded: string[] = [];
      const degradeEvents: EventDraft[] = [];

      if (tier === "s2" && !canAffordS2(k, snap, anchorReason).ok) {
        const applied = applyDegradeList(k, flags, true, anchorReason);
        tier = applied.tier;
        degraded.push(...applied.degraded);
        degradeEvents.push(...applied.events);
      }

      const routeDraft: EventDraft = {
        kind: "route.decided",
        source: "router",
        tier,
        reasons,
        degraded: degraded.length ? degraded : undefined,
      };

      return {
        decision: { tier, reasons, degraded },
        events: [...degradeEvents, routeDraft],
      };
    },

    allow(job: SideJob) {
      const events: EventDraft[] = [];
      const snap = budgetSnapshot(k, k.timeline.state().scene?.id, undefined);

      if (job === "reflection" && flags.deferReflection) {
        events.push(budgetDegradedDraft("side_job", "defer_reflection"));
        return { ok: false, events };
      }
      if (job === "offscreen_narrate" && flags.skipOffscreenNarrate) {
        events.push(budgetDegradedDraft("side_job", "skip_offscreen_narrate"));
        return { ok: false, events };
      }
      if (job === "autonomous" && flags.skipAutonomous) {
        events.push(budgetDegradedDraft("side_job", "skip_autonomous"));
        return { ok: false, events };
      }

      if (job === "autonomous" || job === "offscreen_narrate") {
        const afford = canAffordS2(k, snap, false);
        if (!afford.ok) {
          const action = job === "autonomous" ? "skip_autonomous" : "skip_offscreen_narrate";
          events.push(budgetDegradedDraft("side_job", action));
          return { ok: false, events };
        }
      }

      return { ok: true, events };
    },
  };
}
