import type { CharacterDef, FieldDef, Goal, ItemDef, LocationDef } from "./schema/authored.ts";
import type { CharacterId, EventId, JsonValue, Lod, SceneId, WorldTime } from "./types.ts";

/**
 * EngineState — the projection of a branch's event log (I2). CONTRACT file.
 * `reduce(state, event)` in timeline/reducer.ts is a pure function; `initialState(authored, policy)` builds the t0 state.
 * State must be JSON-serialisable (snapshots). Additive changes only; document in architecture.md.
 */
export interface TrackStore {
  /** self-scope tracks: track -> value */
  self: Record<string, number>;
  /** relation-scope tracks: target -> track -> value */
  toward: Record<CharacterId, Record<string, number>>;
}
export interface TierStore {
  self: Record<string, string | null>;
  toward: Record<CharacterId, Record<string, string | null>>;
}

export interface CharacterState {
  id: CharacterId;
  name: string;
  lod: Lod;
  origin: "authored" | "generated";
  tracks: TrackStore;
  tiers: TierStore;
  /** freeform per-character variables (incl. counters like `interactions`) and game-defined values */
  vars: Record<string, JsonValue>;
  tags: string[];
  location?: string;
  /** current goals (authored goals + accepted reflection changes) */
  goals: Goal[];
  /** claims the character believes: {s,p,o} */
  claims: { s: string; p: string; o: string; src?: EventId }[];
  /** number of turns this character was the addressee/speaker with the player */
  interactions: number;
  /** ids of secrets that are unlocked */
  unlockedSecrets: string[];
  /** last time memory/offscreen simulation was caught-up */
  lastSimulated: WorldTime;
}

export interface LocationState { id: string; name: string; vars: Record<string, JsonValue>; lastSimulated: WorldTime }
export interface ItemState { id: string; name: string; holder: { kind: string; ref?: string } | null; vars: Record<string, JsonValue> }

export interface ActiveField {
  def: FieldDef;
  grantedAt: WorldTime;
  /** scenes elapsed since grant (for ttl/durationScenes) */
  scenesElapsed: number;
  turnsElapsed: number;
  source: "runtime" | "rule" | "anchor" | "beat";
  cost?: { due: boolean; settled: boolean; dueSinceScene?: number };
}

export type AnchorStatus = "pending" | "soft" | "hard" | "forced" | "fulfilled" | "fallback";
export interface AnchorState { status: AnchorStatus; progress: string[]; softAt?: WorldTime; resolvedAt?: WorldTime }

export interface Sidenote { noteId: string; npc: CharacterId; text: string; ttlTurns: number; verbatim: boolean; addedAt: WorldTime }

export interface SceneState {
  id: SceneId;
  location: string;
  participants: CharacterId[];
  turn: number; // turns taken so far
  startedAt: WorldTime;
  fields: string[]; // scene-scoped field ids declared at start
  ended?: boolean;
}

export interface ScheduleState { lastFired?: WorldTime; nextDue?: WorldTime; done?: boolean; phaseIndex?: number; startedAt?: WorldTime; interrupted?: boolean }

export interface EntityAliasEntry {
  label: string;
  by: CharacterId | "player";
}

export interface EntityAliasState {
  nickname?: EntityAliasEntry;
  aliases: Record<string, EntityAliasEntry>;
  addressAs: Record<CharacterId, Record<CharacterId, EntityAliasEntry>>;
}

export interface DeckRuntimeState {
  lastDrawDay?: number;
  drawsToday: number;
  onceUsed: string[];
  lastEntryId?: string;
  lastDrawAt?: WorldTime;
}

export interface EngineState {
  time: WorldTime;
  /** last assigned event counter in this chain */
  seq: number;
  vars: Record<string, JsonValue>;
  locations: Record<string, LocationState>;
  items: Record<string, ItemState>;
  characters: Record<CharacterId, CharacterState>;
  /** where the player currently is */
  playerLocation?: string;
  /** runtime-granted/active fields (author-declared fields live in `Authored.fields` and are activated by scope) */
  fields: Record<string, ActiveField>;
  anchors: Record<string, AnchorState>;
  beat: { current: string | null; entered: string[] };
  sidenotes: Sidenote[];
  exceptions: Record<string, { usedInPeriod: number; periodKey: string }>;
  schedule: Record<string, ScheduleState>;
  scene: SceneState | null;
  sceneCount: number;
  turnCount: number;
  /** marginal counters: key `${owner}|${target ?? ""}|${eventType}` → {n, lastT(absolute minutes)} */
  counters: Record<string, { n: number; lastMinutes: number }>;
  /** per-turn track change accumulators for turn_cap: reset every turn (turn id) */
  turnAcc: { turn: string | null; delta: Record<string, number> };
  /** windows opened by rules: id → {until scene count, owner, target} */
  windows: Record<string, { untilScene: number; owner: CharacterId; target?: CharacterId }>;
  /** fired thresholds: `${thresholdId}|${owner}|${target}` → true */
  firedThresholds: Record<string, true>;
  grants: { viewer: string; path: string; expiresAt?: WorldTime }[];
  /** S2/S1 usage accounting */
  budget: { turns: number; s2Turns: number; s2Scene: number; degraded: string[] };
  /** memory index: owner → entry count/ids by kind (entries themselves live in artifacts) */
  memoryIndex: Record<CharacterId, { count: number; lastId?: string }>;
  config: { hash: string; mods?: { id: string; version: string; contentHash: string }[] };
  /** entities generated at runtime (from `entity.created` / `entity.spawned` events); mirrored to timelines/<branch>/entities/ */
  generated: { characters: Record<string, CharacterDef>; locations: Record<string, LocationDef>; items: Record<string, ItemDef> };
  /** runtime nicknames / aliases (from `entity.alias_set`) */
  aliases?: Record<CharacterId, EntityAliasState>;
  /** spawned entity id sequence for `dyn-####` allocation */
  entitySeq?: number;
  /** retired dynamic entities (`entity.retired`); stay in log for replay */
  retired?: Record<CharacterId, true>;
  /** random event deck draw state */
  decks?: Record<string, DeckRuntimeState>;
  /** event ids of redacted (purged) events handled by reducer no-op */
  purged: string[];
}
