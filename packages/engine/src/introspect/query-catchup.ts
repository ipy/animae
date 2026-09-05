import type { Kernel } from "../contracts.ts";
import type { EntityRef, Viewer } from "../types.ts";
import { compareTime } from "../world/calendar.ts";
import { fidelityForEntity } from "../world/offscreen.ts";

/** Map a query path to an offscreen entity when §12.6 lazy catch-up applies. */
export function entityRefForQueryCatchUp(viewer: Viewer, path: string): EntityRef | null {
  if (viewer !== "player") return null;
  const trimmed = path.replace(/^\/+/, "").replace(/\/+$/, "");

  if (trimmed.startsWith("characters/")) {
    const rest = trimmed.slice("characters/".length);
    const slash = rest.indexOf("/");
    const id = slash >= 0 ? rest.slice(0, slash) : rest;
    if (id && id !== "self") return { kind: "character", id };
    return null;
  }

  if (trimmed.startsWith("world/locations/")) {
    const id = trimmed.slice("world/locations/".length);
    if (id) return { kind: "location", id };
  }

  return null;
}

function isStale(k: Kernel, entity: EntityRef): boolean {
  const state = k.timeline.state();
  const now = state.time;
  const cal = k.authored.world.calendar;
  const from =
    entity.kind === "location"
      ? state.locations[entity.id]?.lastSimulated
      : state.characters[entity.id]?.lastSimulated;
  if (!from) return false;
  if (fidelityForEntity(k, entity) === "none") return false;
  return compareTime(from, now, cal) < 0;
}

/**
 * §12.6: before a player `query`, catch up stale locations/characters.
 * Narrate/full fidelity may await S1; rule span (schedule/decay) runs inside `world.catchUp`.
 */
export async function preflightPlayerCatchUp(k: Kernel, viewer: Viewer, path: string): Promise<void> {
  const entity = entityRefForQueryCatchUp(viewer, path);
  if (!entity || !isStale(k, entity)) return;
  await k.m.world.catchUp(entity);
}
