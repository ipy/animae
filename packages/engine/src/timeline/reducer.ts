import type {
  AppraisalEvent,
  CharacterPromoted,
  CharacterVarSet,
  EntityAliasSet,
  EntityCreated,
  EntitySpawned,
  EntityRetired,
  DeckDrawn,
  FieldCostDue,
  FieldAge,
  FieldCostSettled,
  FieldGranted,
  FieldRevoked,
  InputReceived,
  MemoryWritten,
  ReflectionAccepted,
  RouteDecided,
  SceneEnded,
  SceneStarted,
  SidenoteAdded,
  SidenoteExpired,
  TimeAdvanced,
  TrackDelta,
  TierChanged,
  Utterance,
  WorldMoved,
  WorldVarSet,
  RuleWindowOpened,
  RuleThresholdFired,
  BudgetDegraded,
} from "../events.ts";
import type { Goal } from "../schema/authored.ts";
import type { ResolvedPolicy } from "../schema/policy.ts";
import type { ActiveField, EngineState, EntityAliasState } from "../state.ts";
import { characterStateFromDef } from "./initial-state.ts";
import { emptyAliasState, normalizeAliasKey } from "../entities/names.ts";
import { reduceDeckDrawn, resetDeckDailyCounters } from "../world/decks.ts";
import type { CharacterDef } from "../schema/authored.ts";
import type { EngineEvent, EventId, JsonValue, WorldTime } from "../types.ts";
import { tierFor } from "../rules/primitives.ts";
import { trackDefFor } from "./initial-state.ts";
import { worldMinutes } from "./time.ts";

export type Reduce = (state: EngineState, e: EngineEvent) => EngineState;

export function createReducer(getPolicy: () => ResolvedPolicy): Reduce {
  return (state, e) => reduce(state, e, getPolicy());
}

function pl<T>(e: EngineEvent): T {
  return e as unknown as T;
}

export function reduce(state: EngineState, e: EngineEvent, policy: ResolvedPolicy): EngineState {
  const s = structuredClone(state);
  s.seq = Math.max(s.seq, parseSeqFromEvent(e.id));
  switch (e.kind) {
    case "time.advanced": {
      const p = pl<TimeAdvanced & EngineEvent>(e);
      s.decks = resetDeckDailyCounters(s.decks ?? {}, p.to.day);
      s.time = { ...p.to };
      break;
    }
    case "world.var_set": {
      const p = pl<WorldVarSet & EngineEvent>(e);
      s.vars[p.path] = p.value;
      break;
    }
    case "character.var_set": {
      const p = pl<CharacterVarSet & EngineEvent>(e);
      const c = s.characters[p.id];
      if (c) c.vars[p.key] = p.value;
      break;
    }
    case "rule.window_opened": {
      const p = pl<RuleWindowOpened & EngineEvent>(e);
      s.windows[p.id] = { untilScene: p.untilScene, owner: p.owner, target: p.target };
      break;
    }
    case "rule.threshold_fired": {
      const p = pl<RuleThresholdFired & EngineEvent>(e);
      s.firedThresholds[`${p.id}|${p.owner}|${p.target ?? ""}`] = true;
      break;
    }
    case "track.delta":
      applyTrackDelta(s, pl<TrackDelta & EngineEvent>(e), policy);
      break;
    case "tier.changed": {
      const p = pl<TierChanged & EngineEvent>(e);
      applyTierChanged(s, p);
      break;
    }
    case "appraisal":
      applyAppraisalMarginal(s, pl<AppraisalEvent & EngineEvent>(e), policy);
      break;
    case "turn.started": {
      s.turnCount += 1;
      s.turnAcc = { turn: e.turn ?? null, delta: {} };
      if (s.scene) s.scene.turn += 1;
      break;
    }
    case "turn.ended":
      for (const note of s.sidenotes) {
        if (note.ttlTurns > 0) note.ttlTurns -= 1;
      }
      s.sidenotes = s.sidenotes.filter((n) => n.ttlTurns !== 0);
      break;
    case "scene.started": {
      const p = pl<SceneStarted & EngineEvent>(e);
      s.sceneCount += 1;
      s.scene = {
        id: p.sceneId,
        location: p.location,
        participants: [...p.participants],
        turn: 0,
        startedAt: { ...s.time },
        fields: [...p.fields],
        ended: false,
      };
      break;
    }
    case "scene.ended": {
      const p = pl<SceneEnded & EngineEvent>(e);
      if (s.scene?.id === p.sceneId) {
        s.scene.ended = true;
        s.scene = null;
      }
      break;
    }
    case "field.granted": {
      const p = pl<FieldGranted & EngineEvent>(e);
      const f = p.field;
      s.fields[f.id] = {
        def: f,
        grantedAt: { ...s.time },
        scenesElapsed: 0,
        turnsElapsed: 0,
        source: f.source === "author" ? "rule" : (f.source as ActiveField["source"]),
      };
      break;
    }
    case "field.revoked": {
      const p = pl<FieldRevoked & EngineEvent>(e);
      delete s.fields[p.field];
      break;
    }
    case "field.cost_due": {
      const p = pl<FieldCostDue & EngineEvent>(e);
      const af = s.fields[p.field];
      if (af) af.cost = { due: true, settled: false, dueSinceScene: s.sceneCount };
      break;
    }
    case "field.cost_settled": {
      const p = pl<FieldCostSettled & EngineEvent>(e);
      const af = s.fields[p.field];
      if (af) af.cost = { due: false, settled: true };
      break;
    }
    case "field.age": {
      const p = pl<FieldAge & EngineEvent>(e);
      const af = s.fields[p.field];
      if (af) {
        if (p.scenes) af.scenesElapsed += p.scenes;
        if (p.turns) af.turnsElapsed += p.turns;
      }
      break;
    }
    case "anchor.progress": {
      const ap = pl<{ anchor: string; stage: string } & EngineEvent>(e);
      const id = ap.anchor;
      const stage = ap.stage;
      const a = s.anchors[id] ?? { status: "pending", progress: [] };
      a.progress.push(stage);
      if (stage === "soft") a.status = "soft";
      else if (stage === "hard") a.status = "hard";
      else if (stage === "force") a.status = "forced";
      s.anchors[id] = a;
      break;
    }
    case "anchor.fulfilled": {
      const id = pl<{ anchor: string } & EngineEvent>(e).anchor;
      const a = s.anchors[id] ?? { status: "pending", progress: [] };
      a.status = "fulfilled";
      a.resolvedAt = { ...s.time };
      s.anchors[id] = a;
      break;
    }
    case "anchor.fallback": {
      const id = pl<{ anchor: string } & EngineEvent>(e).anchor;
      const a = s.anchors[id] ?? { status: "pending", progress: [] };
      a.status = "fallback";
      a.resolvedAt = { ...s.time };
      s.anchors[id] = a;
      break;
    }
    case "beat.entered": {
      const beat = pl<{ beat: string } & EngineEvent>(e).beat;
      s.beat.current = beat;
      if (!s.beat.entered.includes(beat)) s.beat.entered.push(beat);
      break;
    }
    case "beat.exited":
      s.beat.current = null;
      break;
    case "sidenote.added": {
      const p = pl<SidenoteAdded & EngineEvent>(e);
      s.sidenotes.push({ noteId: p.noteId, npc: p.npc, text: p.text, ttlTurns: p.ttlTurns, verbatim: p.verbatim, addedAt: { ...s.time } });
      break;
    }
    case "sidenote.expired": {
      const p = pl<SidenoteExpired & EngineEvent>(e);
      s.sidenotes = s.sidenotes.filter((n) => n.noteId !== p.noteId);
      break;
    }
    case "exception.used": {
      const p = pl<{ exceptionId: string; periodKey: string } & EngineEvent>(e);
      const ex = s.exceptions[p.exceptionId] ?? { usedInPeriod: 0, periodKey: p.periodKey };
      if (ex.periodKey !== p.periodKey) ex.usedInPeriod = 0;
      ex.periodKey = p.periodKey;
      ex.usedInPeriod += 1;
      s.exceptions[p.exceptionId] = ex;
      break;
    }
    case "schedule.fired": {
      const sf = pl<{ id: string; at: WorldTime } & EngineEvent>(e);
      const id = sf.id;
      s.schedule[id] = { ...(s.schedule[id] ?? {}), lastFired: { ...sf.at }, done: true };
      break;
    }
    case "longevent.phase": {
      const p = pl<{ id: string; phase: string; index: number; startedAt: WorldTime } & EngineEvent>(e);
      s.schedule[p.id] = { ...(s.schedule[p.id] ?? {}), phaseIndex: p.index, startedAt: { ...p.startedAt } };
      break;
    }
    case "longevent.interrupted": {
      const id = pl<{ id: string } & EngineEvent>(e).id;
      s.schedule[id] = { ...(s.schedule[id] ?? {}), interrupted: true };
      break;
    }
    case "offscreen.simulated": {
      const p = pl<{ entity: { kind: string; id: string }; to: WorldTime } & EngineEvent>(e);
      if (p.entity.kind === "character") {
        const c = s.characters[p.entity.id];
        if (c) c.lastSimulated = { ...p.to };
      } else if (p.entity.kind === "location") {
        const loc = s.locations[p.entity.id];
        if (loc) loc.lastSimulated = { ...p.to };
      }
      break;
    }
    case "world.moved": {
      const p = pl<WorldMoved & EngineEvent>(e);
      const c = s.characters[p.who];
      if (c) c.location = p.to;
      if (p.who === "player") s.playerLocation = p.to;
      break;
    }
    case "item.moved": {
      const p = pl<{ item: string; to: { kind: string; ref?: string } | null } & EngineEvent>(e);
      const it = s.items[p.item];
      if (it) it.holder = p.to ? { kind: p.to.kind, ref: p.to.ref } : null;
      break;
    }
    case "entity.created":
      applyEntityCreated(s, pl<EntityCreated & EngineEvent>(e), policy);
      break;
    case "entity.spawned":
      applyEntitySpawned(s, pl<EntitySpawned & EngineEvent>(e), policy);
      break;
    case "entity.retired": {
      const p = pl<EntityRetired & EngineEvent>(e);
      if (p.entity.kind === "character") {
        s.retired = s.retired ?? {};
        s.retired[p.entity.id] = true;
      }
      break;
    }
    case "entity.alias_set":
      applyEntityAliasSet(s, pl<EntityAliasSet & EngineEvent>(e));
      break;
    case "deck.drawn": {
      const p = pl<DeckDrawn & EngineEvent>(e);
      s.decks = reduceDeckDrawn(s.decks ?? {}, p.deckId, p.entryId, p.at, p.entryOnce);
      break;
    }
    case "character.promoted": {
      const p = pl<CharacterPromoted & EngineEvent>(e);
      const c = s.characters[p.id];
      if (c) c.lod = p.to;
      if (p.data) {
        mergePromotedData(s, p.id, p.data);
      }
      break;
    }
    case "memory.written": {
      const p = pl<MemoryWritten & EngineEvent>(e);
      const idx = s.memoryIndex[p.owner] ?? { count: 0 };
      idx.count += 1;
      idx.lastId = p.memoryId;
      s.memoryIndex[p.owner] = idx;
      break;
    }
    case "reflection.accepted": {
      const p = pl<ReflectionAccepted & EngineEvent>(e);
      const c = s.characters[p.owner];
      if (c) {
        applyGoalChanges(c, p.goal_changes);
        for (const cl of p.new_claims) c.claims.push({ ...cl, src: e.id });
      }
      break;
    }
    case "visibility.granted": {
      const p = pl<{ viewer: string; path: string; expiresAt?: WorldTime } & EngineEvent>(e);
      s.grants.push({ viewer: p.viewer, path: p.path, expiresAt: p.expiresAt ? { ...p.expiresAt } : undefined });
      break;
    }
    case "visibility.expired": {
      const p = pl<{ viewer: string; path: string } & EngineEvent>(e);
      s.grants = s.grants.filter((g) => !(g.viewer === p.viewer && g.path === p.path));
      break;
    }
    case "budget.degraded": {
      const p = pl<BudgetDegraded & EngineEvent>(e);
      const parts = p.degraded ?? (p.action ? [p.action] : []);
      s.budget.degraded.push(...parts);
      break;
    }
    case "route.decided": {
      const p = pl<RouteDecided & EngineEvent>(e);
      s.budget.turns += 1;
      if (p.tier === "s2") s.budget.s2Turns += 1;
      break;
    }
    case "config.reloaded": {
      const p = pl<{ hash: string; mods?: { id: string; version: string; contentHash: string }[] } & EngineEvent>(e);
      s.config.hash = p.hash;
      if (p.mods) s.config.mods = p.mods;
      break;
    }
    case "utterance":
      applyUtteranceInteractions(s, pl<Utterance & EngineEvent>(e), policy);
      break;
    case "input.received":
      applyInputInteractions(s, pl<InputReceived & EngineEvent>(e), policy);
      break;
    case "purge.applied": {
      const ids = pl<{ eventIds?: EventId[] } & EngineEvent>(e).eventIds ?? [];
      for (const id of ids) if (!s.purged.includes(id)) s.purged.push(id);
      break;
    }
    default:
      break;
  }
  return s;
}

function parseSeqFromEvent(id: EventId | undefined): number {
  if (!id) return 0;
  const m = /^evt_(\d+)$/.exec(id);
  return m ? Number.parseInt(m[1]!, 10) : 0;
}

function applyTrackDelta(s: EngineState, e: EngineEvent<TrackDelta>, policy: ResolvedPolicy): void {
  const c = s.characters[e.owner];
  if (!c) return;
  const def = trackDefFor(policy, e.track);
  if (e.target) {
    c.tracks.toward[e.target] = c.tracks.toward[e.target] ?? {};
    c.tracks.toward[e.target]![e.track] = e.after;
    if (def) {
      const stored = c.tiers.toward[e.target]?.[e.track] ?? null;
      const { tier, direction } = tierFor(e.after, def.tiers ?? [], stored, def.hysteresis ?? 0);
      c.tiers.toward[e.target] = c.tiers.toward[e.target] ?? {};
      if (direction !== "same") c.tiers.toward[e.target]![e.track] = tier;
    }
  } else {
    c.tracks.self[e.track] = e.after;
    if (def) {
      const stored = c.tiers.self[e.track] ?? null;
      const { tier, direction } = tierFor(e.after, def.tiers ?? [], stored, def.hysteresis ?? 0);
      if (direction !== "same") c.tiers.self[e.track] = tier;
    }
  }
  const reason = e.reason ?? "";
  if (reason !== "decay" && reason !== "carry" && e.delta !== 0) {
    const key = `${e.owner}|${e.target ?? ""}|${e.track}`;
    s.turnAcc.delta[key] = (s.turnAcc.delta[key] ?? 0) + Math.abs(e.delta);
  }
}

function applyTierChanged(s: EngineState, e: EngineEvent<TierChanged>): void {
  const c = s.characters[e.owner];
  if (!c) return;
  if (e.target) {
    c.tiers.toward[e.target] = c.tiers.toward[e.target] ?? {};
    c.tiers.toward[e.target]![e.track] = e.to;
  } else {
    c.tiers.self[e.track] = e.to;
  }
}

function applyAppraisalMarginal(s: EngineState, e: EngineEvent<AppraisalEvent>, policy: ResolvedPolicy): void {
  const halfLife = policy.rules.marginal?.halfLifeHours ?? 24;
  const owner = e.addressee;
  const target = e.actor;
  const eventType = e.appraisal.type;
  const key = `${owner}|${target}|${eventType}`;
  const prev = s.counters[key];
  const hours = prev ? Math.abs(worldMinutes(s.time) - prev.lastMinutes) / 60 : 0;
  const decayed = prev ? prev.n * 0.5 ** (hours / halfLife) : 0;
  const n = decayed + 1;
  s.counters[key] = { n, lastMinutes: worldMinutes(s.time) };
}

function applyUtteranceInteractions(s: EngineState, e: EngineEvent<Utterance>, policy: ResolvedPolicy): void {
  const player = (policy as { x?: { player?: string } }).x?.player ?? "player";
  if (e.addressee === player) {
    const npc = s.characters[e.speaker];
    if (npc) npc.interactions += 1;
  }
}

function applyInputInteractions(s: EngineState, e: EngineEvent<InputReceived>, policy: ResolvedPolicy): void {
  const player = (policy as { x?: { player?: string } }).x?.player ?? "player";
  if (e.actor === player && e.addressee && e.addressee !== player) {
    const npc = s.characters[e.addressee];
    if (npc) npc.interactions += 1;
  }
}

function applyGoalChanges(c: { goals: Goal[] }, changes: unknown[]): void {
  for (const raw of changes) {
    if (!raw || typeof raw !== "object") continue;
    const ch = raw as { id?: string; action?: string; text?: string; tags?: string[]; priority?: number };
    if (ch.action === "add") {
      c.goals.push({
        id: ch.id ?? `goal_${c.goals.length + 1}`,
        text: ch.text ?? "",
        tags: ch.tags ?? [],
        priority: ch.priority ?? 0,
      });
    } else if (ch.action === "remove" && ch.id) {
      c.goals = c.goals.filter((g) => g.id !== ch.id);
    } else if (ch.action === "update" && ch.id) {
      const g = c.goals.find((x) => x.id === ch.id);
      if (g) {
        if (ch.text !== undefined) g.text = ch.text;
        if (ch.tags !== undefined) g.tags = ch.tags;
        if (ch.priority !== undefined) g.priority = ch.priority;
      }
    }
  }
}

function mergePromotedData(s: EngineState, id: string, data: Record<string, JsonValue>): void {
  const prev = (s.generated.characters[id] ?? {}) as Record<string, JsonValue>;
  s.generated.characters[id] = { ...prev, ...data } as unknown as CharacterDef;
  const c = s.characters[id];
  if (c && typeof data.name === "string") c.name = data.name;
  if (c && typeof data.tags === "object" && Array.isArray(data.tags)) {
    c.tags = data.tags as string[];
  }
}

function applyEntityCreated(s: EngineState, e: EngineEvent<EntityCreated>, policy: ResolvedPolicy): void {
  const { entity, data } = e;
  if (entity.kind === "character") {
    s.generated.characters[entity.id] = data as never;
    if (!s.characters[entity.id]) {
      s.characters[entity.id] = {
        id: entity.id,
        name: String(data.name ?? entity.id),
        lod: (data.lod as never) ?? "extra",
        origin: "generated",
        tracks: { self: {}, toward: {} },
        tiers: { self: {}, toward: {} },
        vars: {},
        tags: [],
        goals: [],
        claims: [],
        interactions: 0,
        unlockedSecrets: [],
        lastSimulated: { ...s.time },
      };
      for (const [trackName, def] of Object.entries(policy.tracks)) {
        if (def.scope === "self") s.characters[entity.id]!.tracks.self[trackName] = def.initial;
      }
    }
  } else if (entity.kind === "location") {
    s.generated.locations[entity.id] = data as never;
  } else {
    s.generated.items[entity.id] = data as never;
  }
}

function applyEntitySpawned(s: EngineState, e: EngineEvent<EntitySpawned>, policy: ResolvedPolicy): void {
  const { entity, data } = e;
  if (typeof e.entitySeq === "number") s.entitySeq = Math.max(s.entitySeq ?? 0, e.entitySeq);
  if (entity.kind === "character") {
    const def = data as unknown as CharacterDef;
    s.generated.characters[entity.id] = def;
    const player = (policy as { x?: { player?: string } }).x?.player ?? "player";
    if (!s.characters[entity.id]) {
      s.characters[entity.id] = characterStateFromDef(def, policy, player, s.time);
      s.characters[entity.id]!.origin = "generated";
    } else {
      s.characters[entity.id]!.name = def.card.identity.name;
      s.characters[entity.id]!.lod = def.card.lod ?? "extra";
      s.characters[entity.id]!.tags = def.card.tags ?? [];
      s.characters[entity.id]!.goals = def.goals.map((g) => ({ ...g }));
    }
  } else if (entity.kind === "location") {
    s.generated.locations[entity.id] = data as never;
    if (!s.locations[entity.id]) {
      const loc = data as { id: string; name: string; vars?: Record<string, JsonValue> };
      s.locations[entity.id] = {
        id: entity.id,
        name: String(loc.name ?? entity.id),
        vars: { ...(loc.vars ?? {}) },
        lastSimulated: { ...s.time },
      };
    }
  } else {
    s.generated.items[entity.id] = data as never;
    if (!s.items[entity.id]) {
      const it = data as { id: string; name: string; holder?: { kind: string; ref?: string } | null; vars?: Record<string, JsonValue> };
      s.items[entity.id] = {
        id: entity.id,
        name: String(it.name ?? entity.id),
        holder: it.holder ? { kind: it.holder.kind, ref: it.holder.ref } : null,
        vars: { ...(it.vars ?? {}) },
      };
    }
  }
}

function applyEntityAliasSet(s: EngineState, e: EngineEvent<EntityAliasSet>): void {
  const id = e.entity;
  s.aliases = s.aliases ?? {};
  const cur: EntityAliasState = s.aliases[id] ?? emptyAliasState();
  if (e.nickname !== undefined) {
    if (e.nickname === null) delete cur.nickname;
    else cur.nickname = { label: e.nickname.label, by: e.nickname.by };
  }
  if (e.alias) {
    if ("remove" in e.alias && e.alias.remove) {
      delete cur.aliases[e.alias.key];
    } else if ("label" in e.alias) {
      cur.aliases[normalizeAliasKey(e.alias.label)] = { label: e.alias.label, by: e.alias.by };
    }
  }
  if (e.addressAs) {
    if ("remove" in e.addressAs && e.addressAs.remove) {
      if (cur.addressAs[id]) delete cur.addressAs[id]![e.addressAs.target];
    } else if ("label" in e.addressAs) {
      cur.addressAs[id] = cur.addressAs[id] ?? {};
      cur.addressAs[id]![e.addressAs.target] = { label: e.addressAs.label, by: e.addressAs.by };
    }
  }
  s.aliases[id] = cur;
}
