import type { Kernel, RouteInput, RoutePlan, Router } from "../contracts.ts";
import type { RouteDecided } from "../events.ts";
import { appraiseBindingFor, currentMode, llmRoles, tiersOf } from "../model/select.ts";
import { hasAutonomousRules } from "../rule-backend/autonomous.ts";
import type { S2Tier } from "../model/tier-resolver.ts";
import type { RenderBinding, RuntimeMode } from "../runtime/types.ts";
import type { EventDraft } from "../types.ts";
import {
  budgetDegradedDraft,
  budgetSnapshot,
  canAffordEscalation,
  type DegradeFlags,
  type SideJob,
} from "./budget.ts";
import { routerBudgetK, routerDegrade, s2CapPerTurn } from "./policy-access.ts";
import { evaluateTriggers } from "./triggers.ts";

export { detectContradiction } from "./contradiction.ts";

function renderBinding(k: Kernel, tierId: string): RenderBinding {
  const tier = tiersOf(k).get(tierId);
  return tier ? { backend: "llm", slot: "s2", tier: tier.id, model: tier.port.id } : { backend: "rule" };
}

export function createRouter(k: Kernel): Router {
  const flags: DegradeFlags = {
    deferReflection: false,
    skipOffscreenNarrate: false,
    skipAutonomous: false,
  };

  function clearFlags(): void {
    flags.deferReflection = false;
    flags.skipOffscreenNarrate = false;
    flags.skipAutonomous = false;
  }

  return {
    plan({ turn, mode }): RoutePlan {
      const budget = routerBudgetK(k);
      const order = routerDegrade(k.policy);
      const events: EventDraft[] = [];
      const degraded: string[] = [];
      const roles = llmRoles(k);
      const tiers = tiersOf(k);

      let appraiseLlm = mode.appraise === "llm" && roles.s1;
      let renderLlm = mode.render === "llm" && roles.s2;
      // the S2 tier the render would use; only meaningful while `renderLlm`
      let tier: string = renderLlm ? (mode.s2Tier ?? tiers.forJob(turn.autonomous ? "autonomous" : "render").id) : "";

      const degrade = (action: string, from: string, to: string, reason: string) => {
        degraded.push(action);
        events.push(budgetDegradedDraft("plan", action, { from, to, reason }));
      };
      const renderToRule = (reason: string) => {
        degrade("s2_to_rule", tier || "llm", "rule", reason);
        renderLlm = false;
        tier = "";
      };
      const appraiseToRule = (reason: string) => {
        degrade("s1_to_rule", "llm", "rule", reason);
        appraiseLlm = false;
      };

      // A role whose per-turn call cap is zero never reaches a model.
      if (appraiseLlm && (budget.s1PerTurn ?? 1) < 1) appraiseToRule("s1PerTurn");
      if (renderLlm) {
        while (renderLlm && s2CapPerTurn(k.policy, tier) < 1) {
          const lower = order.includes("s2_tier_down") ? tiers.lower(tier) : undefined;
          if (!lower) {
            renderToRule("s2PerTurn");
            break;
          }
          degrade("s2_tier_down", tier, lower.id, "s2PerTurn");
          tier = lower.id;
        }
      }

      // `syncCallsPerTurn` bounds S1 + S2 model calls; the degrade list says which role gives way first.
      const calls = () => (appraiseLlm ? 1 : 0) + (renderLlm ? 1 : 0);
      for (const action of order) {
        if (calls() <= budget.syncCallsPerTurn) break;
        if (action === "s2_to_rule" && renderLlm) renderToRule("syncCallsPerTurn");
        else if (action === "s1_to_rule" && appraiseLlm) appraiseToRule("syncCallsPerTurn");
      }
      // The list may not name the action that fits the budget; the cap still holds.
      if (calls() > budget.syncCallsPerTurn && renderLlm) renderToRule("syncCallsPerTurn");
      if (calls() > budget.syncCallsPerTurn && appraiseLlm) appraiseToRule("syncCallsPerTurn");

      const effective: RuntimeMode = {
        appraise: appraiseLlm ? "llm" : "rule",
        render: renderLlm ? "llm" : "rule",
        ...(renderLlm ? { s2Tier: tier } : {}),
      };
      return { mode: effective, events, degraded };
    },

    decide(i: RouteInput) {
      const mode = i.mode ?? currentMode(k);
      const appraise = i.appraise ?? appraiseBindingFor(k, mode.appraise);
      const triggers = evaluateTriggers(i, k.policy);
      const events: EventDraft[] = [];
      const degraded: string[] = [...(i.planned ?? [])];
      let render: RenderBinding = { backend: "rule" };
      let escalated = false;

      if (mode.render === "llm" && llmRoles(k).s2) {
        const tiers = tiersOf(k);
        const job = i.turn.autonomous ? "autonomous" : "render";
        const base = (mode.s2Tier ? tiers.get(mode.s2Tier) : undefined) ?? tiers.forJob(job);
        let chosen: S2Tier | undefined = base;
        const upgrade = triggers.length > 0 ? tiers.escalation(base.id) : undefined;
        if (upgrade) {
          const snap = budgetSnapshot(k, i.turn.sceneId, i.turn.turnId);
          const afford = canAffordEscalation(k, snap, triggers.includes("anchor_near"), upgrade.id);
          if (afford.ok) {
            chosen = upgrade;
            escalated = true;
            clearFlags();
          } else {
            // Actions run in the list's order until one of them resolves the shortfall; tiering down always does.
            for (const action of routerDegrade(k.policy)) {
              if (action === "s2_tier_down" || action === "s2_to_rule") break;
              if (action === "defer_reflection") flags.deferReflection = true;
              else if (action === "skip_offscreen_narrate") flags.skipOffscreenNarrate = true;
              else if (action === "skip_autonomous") flags.skipAutonomous = true;
              else continue;
              degraded.push(action);
              events.push(budgetDegradedDraft("route", action, { reason: afford.reason }));
            }
            const resolving = routerDegrade(k.policy).find((a) => a === "s2_tier_down" || a === "s2_to_rule") ?? "s2_tier_down";
            degraded.push(resolving);
            if (resolving === "s2_to_rule") {
              events.push(budgetDegradedDraft("route", resolving, { from: upgrade.id, to: "rule", reason: afford.reason }));
              chosen = undefined;
            } else {
              events.push(budgetDegradedDraft("route", resolving, { from: upgrade.id, to: base.id, reason: afford.reason }));
            }
          }
        }
        if (chosen) render = renderBinding(k, chosen.id);
      }

      const draft: EventDraft & Partial<RouteDecided> = {
        kind: "route.decided",
        source: "router",
        appraise,
        render,
        triggers,
        ...(escalated ? { escalated: true } : {}),
        budget: {
          s1Calls: appraise.backend === "llm" ? 1 : 0,
          s2CallsByTier: render.backend === "llm" ? { [render.tier]: 1 } : {},
        },
        ...(degraded.length ? { degraded } : {}),
      };

      return {
        decision: { appraise, render, triggers, escalated, degraded },
        events: [...events, draft],
      };
    },

    allow(job: SideJob) {
      const events: EventDraft[] = [];
      const mode = currentMode(k);
      const roles = llmRoles(k);

      if (job === "reflection") {
        // reflection is an S1-role job: token-free when the role runs on the rule backend
        if (mode.appraise === "rule" || !roles.s1) return { ok: true, events };
        if (flags.deferReflection) {
          events.push(budgetDegradedDraft("side_job", "defer_reflection", { from: "llm", to: "deferred", reason: "escalation_budget" }));
          return { ok: false, events };
        }
        return { ok: true, events };
      }

      // S2-role jobs: offscreen narration and autonomous dialogue
      if (mode.render === "rule" || !roles.s2) {
        if (job === "autonomous" && !hasAutonomousRules(k)) return { ok: false, events };
        return { ok: true, events };
      }
      if (job === "autonomous" && flags.skipAutonomous) {
        events.push(budgetDegradedDraft("side_job", "skip_autonomous", { from: "llm", to: "skipped", reason: "escalation_budget" }));
        return { ok: false, events };
      }
      if (job === "offscreen_narrate" && flags.skipOffscreenNarrate) {
        events.push(budgetDegradedDraft("side_job", "skip_offscreen_narrate", { from: "llm", to: "skipped", reason: "escalation_budget" }));
        return { ok: false, events };
      }

      const tiers = tiersOf(k);
      let tier = tiers.forJob(job === "autonomous" ? "autonomous" : "offscreen");
      const snap = budgetSnapshot(k, k.timeline.state().scene?.id, undefined);
      // a side job on a tier above the default draws on the same escalation budget as an escalated render
      if (tiers.rank(tier.id) > tiers.rank(tiers.routing.render ?? tiers.defaultId)) {
        const afford = canAffordEscalation(k, snap, false, tier.id);
        if (!afford.ok) {
          const lower = tiers.lower(tier.id) ?? tiers.forJob("render");
          events.push(budgetDegradedDraft("side_job", "s2_tier_down", { from: tier.id, to: lower.id, reason: afford.reason }));
          tier = lower;
        }
      }
      if (s2CapPerTurn(k.policy, tier.id) < 1) {
        const action = job === "autonomous" ? "skip_autonomous" : "skip_offscreen_narrate";
        events.push(budgetDegradedDraft("side_job", action, { from: tier.id, to: "skipped", reason: "s2PerTurn" }));
        return { ok: false, events };
      }
      return { ok: true, events, tier: tier.id };
    },
  };
}
