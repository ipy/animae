import type { Explanation, Introspect, Kernel, ViewerDef } from "../contracts.ts";
import type { EventDraft } from "../types.ts";
import type { Duration, Viewer, WorldTime } from "../types.ts";
import { worldMinutes } from "../timeline/time.ts";
import { buildExplanation } from "./explain.ts";
import { deepFreeze } from "./freeze.ts";
import { resolveQuery } from "./query.ts";
import { evaluateVisibility } from "./visibility.ts";

const customViewers = new WeakMap<Kernel, Map<string, ViewerDef>>();

/** `npc:<id>` viewers may query `characters/self/...`; visibility rules use that alias (§19.4). */
export function resolveNpcSelfQueryPath(viewer: Viewer, path: string): string {
  if (typeof viewer !== "string" || !viewer.startsWith("npc:")) return path;
  const id = viewer.slice(4);
  if (path === "characters/self") return `characters/${id}`;
  if (path.startsWith("characters/self/")) return `characters/${id}/${path.slice("characters/self/".length)}`;
  return path;
}

function parseDurationMinutes(d: Duration | undefined, k: Kernel): number | undefined {
  if (d === undefined) return undefined;
  if (typeof d === "number") return d;
  if (typeof d === "object") {
    return (d.days ?? 0) * 1440 + (d.hours ?? 0) * 60 + (d.minutes ?? 0);
  }
  return k.m.world.parseDuration(d);
}

function expiresAt(now: WorldTime, minutes: number): WorldTime {
  const total = worldMinutes(now) + minutes;
  return { day: Math.floor(total / 1440) + 1, minute: total % 1440 };
}

export function createIntrospect(k: Kernel): Introspect {
  if (!customViewers.has(k)) customViewers.set(k, new Map());

  const canReadImpl = (viewer: Viewer, path: string): boolean => {
    const state = k.timeline.state();
    const visibilityPath = resolveNpcSelfQueryPath(viewer, path);
    return evaluateVisibility(k.policy, viewer, visibilityPath, state.grants, state.time);
  };

  return {
    query(viewer, path) {
      const normalized = resolveNpcSelfQueryPath(viewer, path.replace(/^\/+/, ""));
      const value = resolveQuery(k, viewer, normalized, (p) => canReadImpl(viewer, p));
      if (value === undefined) return undefined;
      return deepFreeze(value);
    },

    canRead(viewer, path) {
      const normalized = resolveNpcSelfQueryPath(viewer, path.replace(/^\/+/, ""));
      return canReadImpl(viewer, normalized);
    },

    async grant(viewer, path, ttl) {
      const now = k.timeline.now();
      const mins = parseDurationMinutes(ttl, k);
      const draft: EventDraft = {
        kind: "visibility.granted",
        source: "introspect",
        viewer,
        path: path.replace(/^\/+/, ""),
        ...(mins !== undefined ? { expiresAt: expiresAt(now, mins) } : {}),
      };
      await k.emit([draft]);
    },

    explain(turnId, viewer) {
      const ex = buildExplanation(k, turnId, viewer);
      return deepFreeze(ex) as Explanation;
    },

    registerViewer(v) {
      customViewers.get(k)!.set(v.id, v);
    },

    async expireGrants() {
      const now = k.timeline.now();
      const drafts: EventDraft[] = [];
      for (const g of k.timeline.state().grants) {
        if (!g.expiresAt) continue;
        if (worldMinutes(now) > worldMinutes(g.expiresAt)) {
          drafts.push({
            kind: "visibility.expired",
            source: "introspect",
            viewer: g.viewer,
            path: g.path,
          });
        }
      }
      if (drafts.length) return k.emit(drafts);
      return [];
    },
  };
}
