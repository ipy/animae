import type { CelEngine } from "../contracts.ts";
import type { AnchorDef, FieldDef } from "../schema/authored.ts";
import type { AnchorState, EngineState } from "../state.ts";
import type { CelContext, EngineEvent, EventDraft, WorldTime } from "../types.ts";
import { worldMinutes } from "../timeline/time.ts";

export function anchorDeadlineMinutes(
  anchor: AnchorDef,
  cel: CelEngine,
  ctx: CelContext,
  toMinutes: (t: WorldTime) => number,
): number | undefined {
  const d = anchor.deadline;
  if (typeof d === "object" && d !== null && "day" in d) return toMinutes(d as WorldTime);
  if (typeof d === "number") return d;
  if (typeof d === "string") {
    const v = cel.eval<number | boolean>(d, ctx);
    if (typeof v === "number") return v;
    if (typeof v === "boolean") return v ? toMinutes(ctx.time as WorldTime) : undefined;
  }
  return undefined;
}

export function anchorTargetMet(anchor: AnchorDef, events: readonly EngineEvent[], cel: CelEngine, ctx: CelContext): boolean {
  const { kind, spec } = anchor.target;
  const recent = [...events].reverse();
  switch (kind) {
    case "world_event": {
      const want = String(spec.event ?? "");
      for (const e of recent) {
        if (e.kind !== want) continue;
        if (spec.match && !cel.bool(String(spec.match), { ...ctx, event: e })) continue;
        return true;
      }
      return false;
    }
    case "info_arrival": {
      for (const e of recent) {
        if (e.kind !== "info_arrival") continue;
        const p = e as EngineEvent<{ tags?: string[]; claim?: { s: string; p: string; o: string }; knowledge?: string }>;
        if (spec.knowledge && p.knowledge !== spec.knowledge) continue;
        if (spec.tags && Array.isArray(spec.tags)) {
          const tags = p.tags ?? [];
          if (!spec.tags.every((t) => tags.includes(String(t)))) continue;
        }
        if (spec.claim && p.claim) {
          const c = spec.claim as { s: string; p: string; o: string };
          if (p.claim.s !== c.s || p.claim.p !== c.p || p.claim.o !== c.o) continue;
        }
        return true;
      }
      return false;
    }
    case "character_state": {
      const character = String(spec.character ?? "");
      const when = spec.when;
      if (!when) return false;
      const charCtx = { ...ctx, self: ctx.characters ? (ctx.characters as Record<string, unknown>)[character] : ctx.self };
      return cel.bool(String(when), charCtx);
    }
    case "character_choice": {
      const character = String(spec.character ?? "");
      const choiceTag = String(spec.choice ?? "");
      for (const e of recent) {
        if (e.kind !== "choice.taken") continue;
        const p = e as EngineEvent<{ character?: string; choice?: string; choiceId?: string; tags?: string[] }>;
        const who = p.character ?? (p as { actor?: string }).actor;
        if (who !== character) continue;
        const tags = p.tags ?? [];
        if (p.choiceId === choiceTag || p.choice === choiceTag || tags.includes(choiceTag)) return true;
      }
      return false;
    }
    default:
      return false;
  }
}

export function scenesUntilDeadline(deadlineMin: number, nowMin: number, sceneMinutes: number): number {
  const diff = deadlineMin - nowMin;
  if (diff <= 0) return 0;
  return diff / sceneMinutes;
}

export function isLastTurnBeforeDeadline(
  deadlineMin: number,
  nowMin: number,
  sceneMinutes: number,
  turnMinutes: number,
): boolean {
  const remaining = deadlineMin - nowMin;
  return remaining > 0 && remaining <= sceneMinutes + turnMinutes;
}

export function anchorNear(scenesLeft: number, n: number): boolean {
  return scenesLeft <= n && scenesLeft !== Infinity;
}

export function anchorsReferencing(ref: string, anchors: AnchorDef[]): AnchorDef[] {
  return anchors.filter((a) => a.refs.includes(ref) || anchorTargetReferences(a, ref));
}

function anchorTargetReferences(a: AnchorDef, ref: string): boolean {
  const spec = a.target.spec;
  if (spec.character === ref) return true;
  if (spec.knowledge === ref) return true;
  return false;
}

export function ensureSoftField(anchor: AnchorDef): FieldDef | undefined {
  if (!anchor.soft) return undefined;
  return { ...anchor.soft, id: anchor.soft.id ?? `${anchor.id}-soft`, source: "anchor" };
}

export function ensureForceField(anchor: AnchorDef): FieldDef | undefined {
  if (!anchor.force) return undefined;
  return { ...anchor.force, id: anchor.force.id ?? `${anchor.id}-force`, source: "anchor", level: anchor.force.level ?? "L2" };
}

export function activeAnchorStatus(state: EngineState, id: string): AnchorState {
  return state.anchors[id] ?? { status: "pending", progress: [] };
}

export function isTerminal(status: string): boolean {
  return status === "fulfilled" || status === "fallback";
}
