import type { CelEngine } from "../contracts.ts";
import type { FieldDef } from "../schema/authored.ts";
import type { EngineState } from "../state.ts";
import type { CelContext, WorldTime } from "../types.ts";
import { worldMinutes } from "../timeline/time.ts";
import type { SceneSlice } from "./holder.ts";
import { holderInvolved } from "./holder.ts";

export interface ScopeContext {
  scene?: SceneSlice & { turn: number };
  owner?: string;
  target?: string;
  cel: CelEngine;
  celCtx: CelContext;
  state: Readonly<EngineState>;
  now: WorldTime;
  /** turns since this field instance became active (author/declared session tracking) */
  turnsActive?: number;
  /** scenes elapsed for runtime fields (from ActiveField) */
  scenesElapsed?: number;
  turnsElapsed?: number;
}

export function scopeMatches(def: FieldDef, ctx: ScopeContext): boolean {
  const s = def.scope;
  if (s.scene && ctx.scene && s.scene !== ctx.scene.id) return false;
  if (s.location && ctx.scene && s.location !== ctx.scene.location) return false;
  if (s.characters?.length) {
    const owner = ctx.owner;
    const target = ctx.target;
    const ok =
      (owner && s.characters.includes(owner)) ||
      (target && s.characters.includes(target)) ||
      (!owner && !target);
    if (!ok) return false;
  }
  if (s.time) {
    const m = worldMinutes(ctx.now);
    const from = worldMinutes(s.time.from);
    const to = worldMinutes(s.time.to);
    if (m < from || m > to) return false;
  }
  if (s.turns !== undefined) {
    const elapsed = ctx.turnsElapsed ?? ctx.turnsActive ?? 0;
    if (elapsed >= s.turns) return false;
  }
  if (s.when) {
    const whenCtx = { ...ctx.celCtx, scope: { characters: s.characters ?? [] } };
    if (!ctx.cel.bool(s.when, whenCtx)) return false;
  }
  if (!holderInvolved(def, ctx.scene, ctx.state)) return false;
  return true;
}
