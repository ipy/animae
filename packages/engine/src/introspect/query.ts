import type { FieldEffects } from "../schema/authored.ts";
import type { EngineState } from "../state.ts";
import type { Kernel } from "../contracts.ts";
import type { Viewer } from "../types.ts";
import { memorySyncList } from "../memory/service.ts";
import { evaluateVisibility, eventKindAllowed } from "./visibility.ts";

function l4ForOwner(k: Kernel, owner: string): FieldEffects {
  try {
    const scene = k.timeline.state().scene;
    const resolved = k.m.fields.resolve({
      owner: owner as import("../types.ts").CharacterId,
      ctx: k.celContext({ self: owner as import("../types.ts").CharacterId }),
      scene: scene
        ? {
            id: scene.id,
            location: scene.location,
            participants: scene.participants,
            turn: scene.turn,
          }
        : undefined,
    });
    return resolved.effects.L4;
  } catch {
    return {};
  }
}

function filterMemoryForSelf(entries: import("../contracts.ts").MemoryEntry[], l4: FieldEffects) {
  const suppress = new Set(l4.suppress_memory_tags ?? []);
  if (!suppress.size) return entries;
  return entries.filter((e) => !e.tags.some((t) => suppress.has(t)));
}

function characterSummary(k: Kernel, id: string, viewer: Viewer, state: EngineState): Record<string, unknown> | undefined {
  const c = state.characters[id];
  const def = k.catalog.character(id);
  if (!c || !def) return undefined;
  const base: Record<string, unknown> = {
    id: c.id,
    name: c.name,
    lod: c.lod,
    location: c.location,
    tags: [...c.tags],
  };
  if (viewer === `npc:${id}`) {
    const l4 = l4ForOwner(k, id);
    if (l4.hide_entities?.length) {
      base.hidden_from_self = l4.hide_entities;
    }
    if (l4.disguise && Object.keys(l4.disguise).length) base.disguise = { ...l4.disguise };
    if (l4.inject_belief?.length) base.injected_beliefs = l4.inject_belief.map((b) => ({ ...b }));
  }
  return base;
}

function worldVarsForPlayer(k: Kernel, state: EngineState, viewer: Viewer): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const publicKeys = new Set(k.authored.world.public_vars ?? []);
  for (const [key, val] of Object.entries(state.vars)) {
    const path = `world/vars/${key}`;
    if (publicKeys.has(key)) {
      out[key] = val;
      continue;
    }
    if (evaluateVisibility(k.policy, viewer, path, state.grants, state.time)) {
      out[key] = val;
    }
  }
  return out;
}

export function resolveQuery(k: Kernel, viewer: Viewer, path: string, canRead: (p: string) => boolean): unknown {
  const state = k.timeline.state();
  const trimmed = path.replace(/\/+$/, "");

  if (trimmed === "characters") {
    if (!canRead("characters")) return undefined;
    const list = Object.keys(state.characters)
      .filter((id) => canRead(`characters/${id}`) || canRead(`characters/${id}/identity`))
      .map((id) => characterSummary(k, id, viewer, state))
      .filter((x): x is Record<string, unknown> => x !== undefined);
    return list;
  }

  if (trimmed.startsWith("characters/")) {
    const rest = trimmed.slice("characters/".length);
    const slash = rest.indexOf("/");
    const id = slash >= 0 ? rest.slice(0, slash) : rest;
    const sub = slash >= 0 ? rest.slice(slash + 1) : "";
    const charPath = sub ? `characters/${id}/${sub}` : `characters/${id}`;
    if (!canRead(charPath) && !canRead(`characters/${id}`)) return undefined;

    const c = state.characters[id];
    const def = k.catalog.character(id);
    if (!c || !def) return undefined;

    if (!sub) {
      return {
        ...characterSummary(k, id, viewer, state),
        identity: def.card.identity,
        constraints: def.card.constraints,
        traits: def.traits,
        goals: c.goals,
        secrets: def.secrets.filter((s) => c.unlockedSecrets.includes(s.id)),
      };
    }

    switch (sub) {
      case "identity":
        return def.card.identity;
      case "constraints":
        return def.card.constraints;
      case "traits":
        return def.traits;
      case "tracks":
        return { self: { ...c.tracks.self }, toward: { ...c.tracks.toward } };
      case "tiers":
        return { self: { ...c.tiers.self }, toward: { ...c.tiers.toward } };
      case "goals":
        return c.goals.map((g) => ({ ...g }));
      case "secrets":
        return def.secrets.filter((s) => c.unlockedSecrets.includes(s.id));
      case "memory": {
        let mem = memorySyncList(k, id);
        if (viewer === `npc:${id}`) mem = filterMemoryForSelf(mem, l4ForOwner(k, id));
        return mem;
      }
      case "knowledge":
        return def.knowledge.map((d) => ({
          id: d.id,
          name: d.name,
          description: d.description,
          scope: d.scope,
          inject: d.inject,
          tags: d.tags,
        }));
      default:
        return undefined;
    }
  }

  if (trimmed === "world/vars") {
    if (!canRead("world/vars")) return undefined;
    if (viewer === "player") return worldVarsForPlayer(k, state, viewer);
    return { ...state.vars };
  }

  if (trimmed.startsWith("world/vars/")) {
    const key = trimmed.slice("world/vars/".length);
    if (!canRead(trimmed)) return undefined;
    if (viewer === "player") {
      const vars = worldVarsForPlayer(k, state, viewer);
      return vars[key];
    }
    return state.vars[key];
  }

  if (trimmed === "world/locations") {
    if (!canRead("world/locations")) return undefined;
    return Object.values(state.locations).map((l) => ({ id: l.id, name: l.name, vars: l.vars }));
  }
  if (trimmed.startsWith("world/locations/")) {
    const id = trimmed.slice("world/locations/".length);
    const charPath = `world/locations/${id}`;
    if (!canRead(charPath) && !canRead("world/locations")) return undefined;
    const loc = state.locations[id] ?? k.catalog.location(id);
    if (!loc) return undefined;
    const st = state.locations[id];
    const authored = loc as {
      summary?: string;
      connects?: Array<{ to: string; label?: string; minutes?: number }>;
    };
    return {
      id: loc.id,
      name: loc.name,
      summary: authored.summary,
      connects: authored.connects,
      vars: st?.vars ?? (loc as { vars?: Record<string, unknown> }).vars ?? {},
      lastSimulated: st?.lastSimulated ?? null,
    };
  }
  if (trimmed === "world/items") {
    if (!canRead("world/items")) return undefined;
    return Object.values(state.items).map((i) => ({ id: i.id, name: i.name, holder: i.holder }));
  }
  if (trimmed === "world/time") {
    if (!canRead("world/time")) return undefined;
    const t = state.time;
    const hh = Math.floor(t.minute / 60);
    const mm = t.minute % 60;
    return { day: t.day, minute: t.minute, hhmm: `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}` };
  }
  if (trimmed === "world/location") {
    if (!canRead("world/location")) return undefined;
    return state.playerLocation ?? null;
  }
  if (trimmed === "world/chapter") {
    if (!canRead("world/chapter")) return undefined;
    const ch = k.m.world.chapter?.(state.time);
    return ch ?? null;
  }
  if (trimmed === "world/fields") {
    if (!canRead("world/fields")) return undefined;
    return Object.keys(state.fields);
  }

  if (trimmed === "scene") {
    if (!canRead("scene")) return undefined;
    const sc = state.scene;
    if (!sc) return null;
    return { id: sc.id, location: sc.location, participants: sc.participants, turn: sc.turn };
  }

  if (trimmed === "director/anchors") {
    if (!canRead("director/anchors")) return undefined;
    try {
      return k.m.director.anchorsReferencing("").map((a) => ({ id: a.id, deadline: (a as { deadline?: unknown }).deadline }));
    } catch {
      return k.authored.anchors.map((a) => ({ id: a.id, deadline: (a as { deadline?: unknown }).deadline }));
    }
  }
  if (trimmed === "director/beat") {
    if (!canRead("director/beat")) return undefined;
    return state.beat;
  }

  if (trimmed === "budget") {
    if (!canRead("budget")) return undefined;
    return { ...state.budget, turns: state.budget.turns, s2Turns: state.budget.s2Turns, s2Scene: state.budget.s2Scene };
  }

  if (trimmed === "ledger") {
    if (!canRead("ledger")) return undefined;
    try {
      return k.m.fields.ledger();
    } catch {
      return [];
    }
  }

  if (trimmed === "events") {
    if (!canRead("events")) return undefined;
    const evs = k.timeline.events().slice(-200);
    return evs
      .filter((e) => eventKindAllowed(k.policy, viewer, e.kind, state.grants, state.time))
      .map((e) => ({ id: e.id, kind: e.kind, t: e.t, scene: e.scene, turn: e.turn }));
  }

  if (trimmed === "timeline") {
    if (!canRead("timeline")) return undefined;
    return { branch: k.timeline.branch(), saves: [] };
  }

  return undefined;
}
