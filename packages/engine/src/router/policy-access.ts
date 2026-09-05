import type { Kernel } from "../contracts.ts";
import type { ResolvedPolicy } from "../schema/policy.ts";

const DEFAULT_BUDGET = {
  syncCallsPerTurn: 2,
  s2PerTurn: 1,
  s2Ratio: 0.15,
  s2ReservedForAnchors: 0.03,
  maxOutputTokens: { s1: 400, s2: 800 },
  sceneS2Pool: undefined as number | undefined,
};

const DEFAULT_DEGRADE = ["s2_to_s1", "defer_reflection", "skip_offscreen_narrate", "skip_autonomous"] as const;

export function routerBudget(policy: ResolvedPolicy) {
  return policy.router.budget ?? DEFAULT_BUDGET;
}

export function routerBudgetK(k: Kernel) {
  return routerBudget(k.policy);
}

export function routerDegrade(policy: ResolvedPolicy) {
  return policy.router.degrade ?? [...DEFAULT_DEGRADE];
}

export function routerTriggers(policy: ResolvedPolicy) {
  return policy.router.triggers ?? {};
}
