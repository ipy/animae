import type { Kernel } from "../contracts.ts";
import type { ResolvedPolicy } from "../schema/policy.ts";

export type DegradeAction = NonNullable<ResolvedPolicy["router"]["degrade"]>[number];

export const DEFAULT_DEGRADE: readonly DegradeAction[] = [
  "s2_tier_down",
  "s2_to_rule",
  "s1_to_rule",
  "defer_reflection",
  "skip_offscreen_narrate",
  "skip_autonomous",
];

const DEFAULT_BUDGET = {
  syncCallsPerTurn: 2,
  s1PerTurn: 1,
  s2PerTurn: 1,
  s2Ratio: 0.15,
  s2ReservedForAnchors: 0.03,
  maxOutputTokens: { s1: 400, s2: 800 as number | Record<string, number> },
  sceneS2Pool: undefined as number | undefined,
  s2PerTurnByTier: undefined as Record<string, number> | undefined,
};

export type RouterBudget = typeof DEFAULT_BUDGET;

export function routerBudget(policy: ResolvedPolicy): RouterBudget {
  const given = policy.router.budget ?? {};
  const defined = Object.fromEntries(Object.entries(given).filter(([, v]) => v !== undefined));
  return { ...DEFAULT_BUDGET, ...defined } as RouterBudget;
}

export function routerBudgetK(k: Kernel): RouterBudget {
  return routerBudget(k.policy);
}

/** Degrade order: the policy's list, or the default order when the policy lists none. */
export function routerDegrade(policy: ResolvedPolicy): readonly DegradeAction[] {
  const list = policy.router.degrade;
  return list && list.length > 0 ? list : DEFAULT_DEGRADE;
}

export function routerTriggers(policy: ResolvedPolicy) {
  return policy.router.triggers ?? {};
}

/** Output token cap of an S2 call on `tier` (one number for every tier, or a per-tier map). */
export function s2MaxOutputTokens(policy: ResolvedPolicy, tier: string | undefined): number {
  const cap = routerBudget(policy).maxOutputTokens.s2;
  if (typeof cap === "number") return cap;
  if (tier !== undefined && cap[tier] !== undefined) return cap[tier]!;
  return cap.default ?? 800;
}

/** S2 calls a tier may make per turn: its entry in `s2PerTurnByTier`, else `s2PerTurn`. */
export function s2CapPerTurn(policy: ResolvedPolicy, tier: string): number {
  const b = routerBudget(policy);
  return b.s2PerTurnByTier?.[tier] ?? b.s2PerTurn;
}
