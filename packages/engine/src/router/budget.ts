import type { Kernel } from "../contracts.ts";
import type { RouteDecided } from "../events.ts";
import type { EventDraft } from "../types.ts";
import { routerBudgetK, s2CapPerTurn } from "./policy-access.ts";

function asRoute(e: { kind: string }): RouteDecided {
  return e as unknown as RouteDecided;
}

export type SideJob = "reflection" | "offscreen_narrate" | "autonomous";

/** Flags the degrade list sets while the escalation budget is exhausted; cleared as soon as an escalation is affordable. */
export interface DegradeFlags {
  deferReflection: boolean;
  skipOffscreenNarrate: boolean;
  skipAutonomous: boolean;
}

export interface BudgetSnapshot {
  turns: number;
  /** renders served by an S2 tier (all tiers) */
  s2Turns: number;
  /** renders that ran on the escalation tier */
  escalated: number;
  /** escalated renders in the current scene */
  escalatedInScene: number;
  /** S2 renders already decided in the current turn */
  s2ThisTurn: number;
}

/** Escalated renders in a scene: `route.decided` events whose render was upgraded. */
export function countEscalatedInScene(k: Kernel, sceneId?: string): number {
  if (!sceneId) return 0;
  let n = 0;
  for (const e of k.timeline.events()) {
    if (e.kind === "route.decided" && e.scene === sceneId && asRoute(e).escalated) n += 1;
  }
  return n;
}

export function countS2ThisTurn(k: Kernel, turnId?: string): number {
  if (!turnId) return 0;
  let n = 0;
  for (const e of k.timeline.events()) {
    if (e.kind === "route.decided" && e.turn === turnId && asRoute(e).render.backend === "llm") n += 1;
  }
  return n;
}

export function budgetSnapshot(k: Kernel, sceneId?: string, turnId?: string): BudgetSnapshot {
  const b = k.timeline.state().budget;
  return {
    turns: b.turns,
    s2Turns: b.s2Turns,
    escalated: b.escalated ?? 0,
    escalatedInScene: countEscalatedInScene(k, sceneId),
    s2ThisTurn: countS2ThisTurn(k, turnId),
  };
}

/** Escalated renders the current scene may use (all of them, including the anchor reserve). */
export function sceneEscalationPool(k: Kernel): number {
  const b = routerBudgetK(k);
  if (b.sceneS2Pool != null) return b.sceneS2Pool;
  const scene = k.timeline.state().scene;
  const n = scene?.participants.length ?? 1;
  return Math.max(b.s2PerTurn, Math.ceil(n * 4 * b.s2Ratio));
}

/** Slots of the pool only an anchor-related escalation may take. */
export function anchorReserveSlots(k: Kernel): number {
  const pool = sceneEscalationPool(k);
  return Math.max(1, Math.ceil(pool * routerBudgetK(k).s2ReservedForAnchors));
}

export function escalationRatioExceeded(k: Kernel): boolean {
  const { turns, escalated } = k.timeline.state().budget;
  if (turns < 1) return false;
  return (escalated ?? 0) / turns > routerBudgetK(k).s2Ratio;
}

/**
 * Whether a render may run on the escalation tier `tier` now: the tier's per-turn cap, the scene pool (minus the
 * anchor reserve unless the escalation is anchor-related), and the share of turns allowed above the default tier.
 */
export function canAffordEscalation(
  k: Kernel,
  snap: BudgetSnapshot,
  anchorReason: boolean,
  tier: string,
): { ok: boolean; reason?: string } {
  if (snap.s2ThisTurn >= s2CapPerTurn(k.policy, tier)) return { ok: false, reason: "s2PerTurn" };
  const pool = sceneEscalationPool(k);
  const generalCap = pool - anchorReserveSlots(k);
  if (anchorReason) {
    if (snap.escalatedInScene >= pool) return { ok: false, reason: "sceneS2Pool" };
  } else if (snap.escalatedInScene >= generalCap) {
    return { ok: false, reason: "sceneS2Pool_general" };
  }
  if (escalationRatioExceeded(k)) return { ok: false, reason: "s2Ratio" };
  return { ok: true };
}

/** `budget.degraded` event: what the role was served by before and after, and which limit forced the change. */
export function budgetDegradedDraft(
  kind: string,
  action: string,
  detail: { from?: string; to?: string; reason?: string } = {},
): EventDraft {
  return {
    kind: "budget.degraded",
    source: "router",
    kind_detail: kind,
    action,
    degraded: [action],
    ...detail,
  };
}
