import type { Authored, CharacterDef } from "../schema/authored.ts";
import type { ResolvedPolicy, TrackDef } from "../schema/policy.ts";
import type { CharacterState, EngineState, TrackStore, TierStore } from "../state.ts";
import type { CharacterId, JsonValue, WorldTime } from "../types.ts";
import { tierFor } from "../rules/primitives.ts";

export function initialState(authored: Authored, policy: ResolvedPolicy): EngineState {
  const player = authored.world.player;
  const time = { ...authored.world.start };
  const characters: Record<CharacterId, CharacterState> = {};
  for (const c of Object.values(authored.characters)) {
    characters[c.id] = characterStateFromDef(c, policy, player, time);
  }
  const locations: EngineState["locations"] = {};
  for (const loc of Object.values(authored.locations)) {
    locations[loc.id] = { id: loc.id, name: loc.name, vars: { ...loc.vars } as Record<string, JsonValue>, lastSimulated: { ...time } };
  }
  const items: EngineState["items"] = {};
  for (const it of Object.values(authored.items)) {
    items[it.id] = {
      id: it.id,
      name: it.name,
      holder: it.holder ? { kind: it.holder.kind, ref: it.holder.ref } : null,
      vars: { ...it.vars } as Record<string, JsonValue>,
    };
  }
  return {
    time: { ...time },
    seq: 0,
    vars: { ...(authored.world.vars as Record<string, JsonValue>) },
    locations,
    items,
    characters,
    playerLocation: authored.world.start_location,
    fields: {},
    anchors: Object.fromEntries(authored.anchors.map((a) => [a.id, { status: "pending" as const, progress: [] }])),
    beat: { current: null, entered: [] },
    sidenotes: [],
    exceptions: {},
    schedule: {},
    scene: null,
    sceneCount: 0,
    turnCount: 0,
    counters: {},
    turnAcc: { turn: null, delta: {} },
    windows: {},
    firedThresholds: {},
    grants: [],
    budget: { turns: 0, s2Turns: 0, s2Scene: 0, degraded: [], s2ByTier: {}, escalated: 0 },
    runtime: { fallbacks: 0 },
    memoryIndex: {},
    config: {
      hash: authored.hash,
      mods: authored.mods?.map((m) => ({ id: m.id, version: m.version, contentHash: m.contentHash })),
    },
    generated: { characters: {}, locations: {}, items: {} },
    aliases: {},
    entitySeq: 0,
    retired: {},
    decks: {},
    purged: [],
  };
}

export function characterStateFromDef(c: CharacterDef, policy: ResolvedPolicy, player: string, time: WorldTime): CharacterState {
  const tracks = buildInitialTracks(c, policy, player);
  const tiers = buildInitialTiers(tracks, policy);
  return {
    id: c.id,
    name: c.card.identity.name,
    lod: c.card.lod ?? "principal",
    origin: c.origin,
    tracks,
    tiers,
    vars: {},
    tags: c.card.tags ?? [],
    goals: c.goals.map((g) => ({ ...g })),
    claims: [],
    interactions: 0,
    unlockedSecrets: [],
    lastSimulated: { ...time },
  };
}

function buildInitialTracks(c: CharacterDef, policy: ResolvedPolicy, player: string): TrackStore {
  const self: Record<string, number> = {};
  const toward: Record<string, Record<string, number>> = {};
  for (const [trackName, def] of Object.entries(policy.tracks)) {
    if (def.scope === "self") {
      self[trackName] = c.tracks.self[trackName] ?? def.initial;
    }
  }
  const towardDefaults = c.tracks.toward["*"] ?? {};
  for (const rel of c.relations) {
    const target = rel.to;
    toward[target] = toward[target] ?? {};
    for (const [trackName, def] of Object.entries(policy.tracks)) {
      if (def.scope !== "relation") continue;
      const fromRel = rel.tracks?.[trackName];
      const fromChar = c.tracks.toward[target]?.[trackName] ?? c.tracks.toward["*"]?.[trackName];
      toward[target]![trackName] = fromRel ?? fromChar ?? towardDefaults[trackName] ?? def.initial;
    }
  }
  for (const [target, vals] of Object.entries(c.tracks.toward)) {
    if (target === "*") continue;
    toward[target] = toward[target] ?? {};
    for (const [trackName, val] of Object.entries(vals)) {
      const def = policy.tracks[trackName];
      if (def?.scope === "relation") toward[target]![trackName] = val;
    }
  }
  if (!toward[player]) {
    toward[player] = {};
    for (const [trackName, def] of Object.entries(policy.tracks)) {
      if (def.scope === "relation") {
        toward[player]![trackName] = c.tracks.toward[player]?.[trackName] ?? towardDefaults[trackName] ?? def.initial;
      }
    }
  }
  return { self, toward };
}

function buildInitialTiers(tracks: TrackStore, policy: ResolvedPolicy): TierStore {
  const self: Record<string, string | null> = {};
  const toward: Record<string, Record<string, string | null>> = {};
  for (const [trackName, def] of Object.entries(policy.tracks)) {
    if (def.scope === "self") {
      self[trackName] = tierFor(tracks.self[trackName] ?? def.initial, def.tiers ?? [], null, def.hysteresis ?? 0).tier;
    }
  }
  for (const [target, tv] of Object.entries(tracks.toward)) {
    toward[target] = {};
    for (const [trackName, val] of Object.entries(tv)) {
      const def = policy.tracks[trackName];
      if (def) toward[target]![trackName] = tierFor(val, def.tiers ?? [], null, def.hysteresis ?? 0).tier;
    }
  }
  return { self, toward };
}

export function trackDefFor(policy: ResolvedPolicy, track: string): TrackDef | undefined {
  return policy.tracks[track];
}
