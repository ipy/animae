import type { Kernel } from "../contracts.ts";
import type { RouteDecided } from "../events.ts";
import type { EventDraft } from "../types.ts";
import { routerBudgetK, routerDegrade } from "./policy-access.ts";

function asRoute(e: { kind: string }): RouteDecided {
  return e as unknown as RouteDecided;
}

export type SideJob = "reflection" | "offscreen_narrate" | "autonomous";

export interface BudgetSnapshot {
  turns: number;
  s2Turns: number;
  s2InScene: number;
  s2ThisTurn: number;
}

export interface DegradeFlags {
  deferReflection: boolean;
  skipOffscreenNarrate: boolean;
  skipAutonomous: boolean;
}

export function countS2InScene(k: Kernel, sceneId?: string): number {
  if (!sceneId) return 0;
  return k.timeline.events().filter((e) => e.kind === "route.decided" && e.scene === sceneId && asRoute(e).tier === "s2").length;
}

export function countS2ThisTurn(k: Kernel, turnId?: string): number {
  if (!turnId) return 0;
  return k.timeline.events().filter((e) => e.kind === "route.decided" && e.turn === turnId && asRoute(e).tier === "s2").length;
}

export function budgetSnapshot(k: Kernel, sceneId?: string, turnId?: string): BudgetSnapshot {
  const b = k.timeline.state().budget;
  return {
    turns: b.turns,
    s2Turns: b.s2Turns,
    s2InScene: countS2InScene(k, sceneId),
    s2ThisTurn: countS2ThisTurn(k, turnId),
  };
}

export function sceneS2PoolLimit(k: Kernel): number {
  const b = routerBudgetK(k);
  if (b.sceneS2Pool != null) return b.sceneS2Pool;
  const scene = k.timeline.state().scene;
  const n = scene?.participants.length ?? 1;
  return Math.max(b.s2PerTurn, Math.ceil(n * 4 * b.s2Ratio));
}

export function anchorReserveSlots(k: Kernel): number {
  const pool = sceneS2PoolLimit(k);
  return Math.max(1, Math.ceil(pool * routerBudgetK(k).s2ReservedForAnchors));
}

export function ratioExceeded(k: Kernel): boolean {
  const { turns, s2Turns } = k.timeline.state().budget;
  if (turns < 1) return false;
  return s2Turns / turns > routerBudgetK(k).s2Ratio;
}

export function canAffordS2(
  k: Kernel,
  snap: BudgetSnapshot,
  anchorReason: boolean,
): { ok: boolean; reason?: string } {
  const b = routerBudgetK(k);
  if (snap.s2ThisTurn >= b.s2PerTurn) return { ok: false, reason: "s2PerTurn" };
  const pool = sceneS2PoolLimit(k);
  const reserve = anchorReserveSlots(k);
  const generalCap = pool - reserve;
  const used = snap.s2InScene;
  if (anchorReason) {
    if (used >= pool) return { ok: false, reason: "sceneS2Pool" };
  } else if (used >= generalCap) {
    return { ok: false, reason: "sceneS2Pool_general" };
  }
  if (ratioExceeded(k)) return { ok: false, reason: "s2Ratio" };
  return { ok: true };
}

export function budgetDegradedDraft(kind: string, action: string): EventDraft {
  return {
    kind: "budget.degraded",
    source: "router",
    kind_detail: kind,
    action,
    degraded: [action],
  };
}

export function applyDegradeList(
  k: Kernel,
  flags: DegradeFlags,
  wantS2: boolean,
  anchorReason: boolean,
): { tier: "s1" | "s2"; degraded: string[]; events: EventDraft[] } {
  const order = routerDegrade(k.policy);
  const events: EventDraft[] = [];
  const degraded: string[] = [];
  let tier: "s1" | "s2" = wantS2 ? "s2" : "s1";

  const snap = budgetSnapshot(k, k.timeline.state().scene?.id, undefined);
  const afford = wantS2 ? canAffordS2(k, snap, anchorReason) : { ok: true };

  if (wantS2 && !afford.ok) {
    for (const action of order) {
      if (action === "s2_to_s1" && !anchorReason) {
        tier = "s1";
        degraded.push(action);
        events.push(budgetDegradedDraft("route", action));
        break;
      }
      if (action === "s2_to_s1" && anchorReason) continue;
      if (action === "defer_reflection") {
        flags.deferReflection = true;
        degraded.push(action);
        events.push(budgetDegradedDraft("route", action));
      }
      if (action === "skip_offscreen_narrate") {
        flags.skipOffscreenNarrate = true;
        degraded.push(action);
        events.push(budgetDegradedDraft("route", action));
      }
      if (action === "skip_autonomous") {
        flags.skipAutonomous = true;
        degraded.push(action);
        events.push(budgetDegradedDraft("route", action));
      }
    }
    if (tier === "s2" && !afford.ok) tier = "s1";
  }

  return { tier, degraded, events };
}
