import type { ModelPort, StoragePort, EmbeddingPort, ImagePort, PromptSegments } from "./ports.ts";
import type { Appraisal } from "./events.ts";
import type { Authored, CharacterDef, FieldDef, FieldEffects, LocationDef, ItemDef, Template, KnowledgeDoc, AnchorDef, ScheduleItem } from "./schema/authored.ts";
import type { ResolvedPolicy, Policy } from "./schema/policy.ts";
import type { EngineState, CharacterState } from "./state.ts";
import type {
  BranchRef, BranchName, CelContext, CharacterId, Duration, EngineEvent, EntityRef, EventDraft, EventId, Lod, Rng, SaveSlot, SceneId, TurnChunk, TurnId, Viewer, WorldTime,
} from "./types.ts";
import type { PresetBundle } from "./preset.ts";

/**
 * Module contracts (who implements what). CONTRACT file — see docs/architecture.md for ownership and conventions.
 * Every module exports a `create*` factory taking the `Kernel` (or the pieces it needs) and returning one of these interfaces.
 */

// ───────────────────────── shared ─────────────────────────
export type Stage = "classify" | "appraise" | "check" | "adjudicate" | "applyFields" | "decide" | "route" | "render" | "commit";

/** Stage hooks replace the default implementation of a stage. IO only through `ctx.ports`; calls are recorded. */
export type StageHook = (ctx: TurnCtx, next: () => Promise<unknown>, k: Kernel) => Promise<unknown>;

export interface RuleCtx {
  stage: string;
  state: Readonly<EngineState>;
  authored: Readonly<Authored>;
  policy: Readonly<ResolvedPolicy>;
  time: WorldTime;
  /** CEL-like context (self, other, event, scene, ...) for the invocation */
  vars: Readonly<CelContext>;
  /** deterministic RNG seeded by timeline seed + event/turn id. The ONLY allowed source of randomness. */
  rng(): number;
}
/** Rule functions are synchronous and pure (I7). */
export type RuleFn = (ctx: Readonly<RuleCtx>) => EventDraft[];

export interface ViewerDef {
  id: string;
  /** extra paths this viewer may read in addition to visibility rules */
  extends?: string; // inherit another viewer's rules
  /** optional per-viewer post-filter */
  filter?: (path: string, value: unknown) => unknown;
}

export interface LedgerEntry { eventId: EventId; kind: string; field?: string; detail: Record<string, unknown> }
/** The scene currently open on the timeline (see `Engine.scene.active`). */
export interface ActiveScene { id: SceneId; location: string; participants: CharacterId[]; turn: number }
export interface SceneReport { sceneId: SceneId; turns: number; events: number; summary?: string; reflections: { owner: CharacterId; accepted: boolean }[]; anchors: { id: string; status: string }[] }
export interface TimelineDiff { state: { path: string; a: unknown; b: unknown }[]; events: { onlyA: EventId[]; onlyB: EventId[]; commonUntil?: EventId } }
export interface Explanation { turnId: TurnId; viewer: Viewer; chain: { eventId: EventId; kind: string; summary: string; data?: unknown }[] }

export interface TurnCtx {
  turnId: TurnId;
  sceneId: SceneId;
  actor: CharacterId;
  addressee: CharacterId;
  speaker: CharacterId;
  text: string;
  choiceId?: string;
  autonomous: boolean;
  /** Per-turn narration language override (web controller UI locale). */
  outputLocale?: string;
  appraisal?: Appraisal;
  /** Host/mod extension: merged into render `extraStatic` when set before the render stage. */
  promptExtraStatic?: string;
  /** Host/mod extension: merged into render `extraDynamic` when set before the render stage. */
  promptExtraDynamic?: string;
  [k: string]: unknown;
}

// ───────────────────────── store ─────────────────────────
// `FsStorage(root)` (src/store/fs.ts) implements StoragePort. `MemoryStorage()` (src/store/memory.ts) is for tests.
// helpers (src/store/util.ts): sha256Hex, stableStringify, parseYaml/stringifyYaml (yaml pkg), readYamlFile, readJsonl, appendJsonl, parseFrontmatter(text) → {data, body}, posix path guards.

// ───────────────────────── policy ─────────────────────────
export interface ConfigWarning { code: string; message: string; file?: string; path?: string }
export interface PolicyLoadResult { policy: ResolvedPolicy; warnings: ConfigWarning[]; presets: PresetBundle[]; hash: string }
export interface PresetRegistry { get(id: string): PresetBundle | undefined; list(): PresetBundle[]; add(b: PresetBundle): void }
/**
 *  loadPolicy(storage, config, presets): resolves preset `extends` chain (deep merge, later overrides) → preset's own policies →
 *  animae.yaml `policies` (list order; `.yaml` docs or `.ts` modules default-exporting a Policy doc).
 *  Throws AnimaeError("CONFIG_INVALID") with file+path for any invalid config.
 */
export type LoadPolicy = (storage: StoragePort, config: Authored["config"], presets: PresetRegistry) => Promise<PolicyLoadResult>;
export type MergePolicies = (layers: { name: string; doc: unknown }[]) => { merged: Policy; warnings: ConfigWarning[] };

// ───────────────────────── authored loading / characters ─────────────────────────
export type LoadAuthored = (storage: StoragePort, opts?: { presets?: PresetRegistry; extraKnowledge?: Record<string, string> }) => Promise<Authored>;

/** Merged read view over authored + generated entities (generated come from EngineState.generated). */
export interface Catalog {
  character(id: string): CharacterDef | undefined;
  characters(): CharacterDef[];
  location(id: string): LocationDef | undefined;
  locations(): LocationDef[];
  item(id: string): ItemDef | undefined;
  template(kind: "character" | "location" | "item", id: string): Template | undefined;
  knowledge(): KnowledgeDoc[]; // world + all character knowledge
}

export interface EntityService {
  generate(r: { kind: "character" | "location" | "item"; template: string; hints?: Record<string, unknown> }, why?: { source: string; because?: string[] }): Promise<EntityRef>;
  promote(id: string, to: Lod, why?: { source: string; because?: string[] }): Promise<void>;
  /** evaluates `characters.lod.promote` + template `promote` rules; emits promotions for characters touched this turn */
  checkPromotions(ids: CharacterId[]): Promise<void>;
  importCard(file: string): Promise<string>;
  exportCard(id: string): Promise<string>;
  setAlias(input: {
    entity: string;
    nickname?: string | null;
    alias?: string;
    by: string | "player";
    target?: string;
    addressLabel?: string;
  }): Promise<void>;
  resolve(ref: string, opts?: { viewer?: CharacterId; speaker?: CharacterId; scope?: CharacterId[] }): { kind: "character"; id: CharacterId };
  spawn(spec: import("./entities/spawn.ts").SpawnEntitySpec, opts?: { reason?: string; id?: string }): Promise<EntityRef>;
  retire(ref: string, opts?: { reason?: string }): Promise<void>;
  generateFromBrief(
    brief: import("./entities/generate-brief.ts").GenerationBrief,
    opts?: { pools?: import("./entities/generate-brief.ts").GenerationPools; reason?: string },
  ): Promise<EntityRef>;
}

// ───────────────────────── rules ─────────────────────────
export interface CelEngine {
  /** returns error message or undefined */
  check(expr: string): string | undefined;
  eval<T = unknown>(expr: string, ctx: CelContext): T;
  bool(expr: string | boolean, ctx: CelContext): boolean;
  num(expr: string | number, ctx: CelContext): number;
  str(expr: string, ctx: CelContext): string;
}
export interface RuleEngine {
  cel: CelEngine;
  register(name: string, fn: RuleFn): void;
  fn(name: string): RuleFn | undefined;
  has(name: string): boolean;
  /** run a registered rule function with a ctx; validates returned drafts */
  run(name: string, ctx: Omit<RuleCtx, "rng"> & { rngKey: string }): EventDraft[];
}

// ───────────────────────── timeline ─────────────────────────
export interface AppendCtx { scene?: SceneId; turn?: TurnId; source?: string; because?: string[] }
export interface ArtifactStore {
  /** merged read across the ancestor chain (ancestors truncated at fork point); write goes to the current branch (copy-on-write) */
  readJsonl<T = unknown>(path: string): Promise<T[]>;
  appendJsonl(path: string, obj: unknown): Promise<void>;
  readText(path: string): Promise<string | undefined>;
  writeText(path: string, text: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
}
export interface RecordingStore {
  mode: "live" | "record" | "replay";
  lookup(key: string): unknown | undefined;
  record(key: string, response: unknown): Promise<void>;
}
export interface TimelineStore {
  open(): Promise<void>;
  close(): Promise<void>;
  branch(): BranchRef;
  chain(): BranchRef[];
  state(): Readonly<EngineState>;
  now(): WorldTime;
  sessionId: string;
  /** assigns ids / t / sid / scene / turn, persists (append+fsync), reduces, notifies subscribers; returns persisted events */
  append(drafts: EventDraft[], ctx?: AppendCtx): Promise<EngineEvent[]>;
  /** in-memory events of the current chain (ancestors truncated at fork), oldest first */
  events(): readonly EngineEvent[];
  eventsByTurn(turn: TurnId): EngineEvent[];
  on(pattern: string, h: (e: EngineEvent) => void): () => void;
  rng(key: string): Rng;
  artifacts: ArtifactStore;
  recordings: RecordingStore;
  // branch import/export manifest
  save(label?: string): Promise<SaveSlot>;
  saves(): Promise<SaveSlot[]>;
  load(slot: SaveSlot | string): Promise<void>;
  rewind(to: EventId): Promise<BranchRef>;
  branches(): Promise<BranchRef[]>;
  switch(b: BranchRef | BranchName): Promise<void>;
  diff(a: BranchRef | BranchName, b: BranchRef | BranchName): Promise<import("./contracts.ts").TimelineDiff>;
  prune(b: BranchRef | BranchName): Promise<void>;
  purge(scope: { characters?: string[]; memoryIds?: string[]; sessions?: string[] }): Promise<void>;
  exportBranch(b: BranchRef | BranchName, o?: { recordings?: boolean; file?: string }): Promise<string>;
  importFile(file: string): Promise<BranchRef>;
  /** events of a branch between ids, for replay */
  readRange(b: BranchRef | BranchName, r?: { from?: EventId; to?: EventId }): Promise<EngineEvent[]>;
  /** called by the engine at a turn boundary so snapshots can be taken (each 200 events and on scene.ended) */
  maybeSnapshot(reason: "count" | "scene_end"): Promise<void>;
}
/** timeline/reducer.ts */
export type Reduce = (state: EngineState, e: EngineEvent) => EngineState; // may mutate-and-return a structuredClone'd draft for performance; MUST be deterministic
export type InitialState = (authored: Authored, policy: ResolvedPolicy) => EngineState;

// ───────────────────────── fields ─────────────────────────
export interface FieldQuery {
  scene?: { id: SceneId; location: string; participants: CharacterId[]; turn: number };
  owner?: CharacterId; // the NPC whose self-view / tracks are being computed
  target?: CharacterId; // counterpart
  eventType?: string;
  ctx: CelContext; // for `scope.when`
}
export interface ResolvedFields {
  /** merged effects per level, already clamped by `fields.caps` */
  effects: { L0: FieldEffects; L1: FieldEffects; L2: FieldEffects; L3: FieldEffects; L4: FieldEffects };
  /** L3 `rule_add` entries from applicable fields (priority desc, id asc; duplicate ids last wins). */
  l3FieldRules: import("./schema/custom-rule.ts").FieldCustomRule[];
  /** L4 effects are per owner self-view; `selfView[owner]` equals effects.L4 for that owner */
  applied: { id: string; level: string; clamped: string[] }[];
  /** highest level among applied fields (for router `field_high`) */
  maxLevel: number;
  /** ledger events (field.applied) to be appended by the caller */
  events: EventDraft[];
}
export interface FieldSystem {
  resolve(q: FieldQuery): ResolvedFields;
  /** runtime grant: checks grants policy (writes field.rejected when denied); returns ledger entry */
  grant(f: FieldDef, why?: { source: string; because?: string[] }): Promise<LedgerEntry>;
  revoke(id: string, why?: { source: string }): Promise<void>;
  /** declare (author-time-like) a field without activating: stored in-memory for the session */
  declare(f: FieldDef): void;
  /** scene/turn boundary bookkeeping: expire ttl scopes, determine cost_due, settle costs/fallbacks; returns events appended */
  onTurnEnd(): Promise<EngineEvent[]>;
  onSceneEnd(): Promise<EngineEvent[]>;
  ledger(): EngineEvent[];
}

// ───────────────────────── director ─────────────────────────
export interface DirectorTick {
  /** fields to activate (soft/force/beat fields) — already granted via FieldSystem */
  granted: string[];
  /** events appended (anchor.progress, beat.*, hard fallback events …) */
  events: EngineEvent[];
  /** distance to nearest unresolved anchor deadline in scenes (Infinity if none) */
  nearestAnchorScenes: number;
  /** anchors referenced → router `anchor_near` */
  anchorNear: boolean;
}
export interface Director {
  /** evaluate anchors/beats at turn start (and before scene start). `observed` = events of the previous turn to match anchor targets. */
  tick(
    when: "scene_start" | "turn_start" | "turn_end" | "time_advanced",
    opts?: { asOf?: import("./types.ts").WorldTime },
  ): Promise<DirectorTick>;
  sidenote(npc: CharacterId, text: string, o?: { ttlTurns?: number; verbatim?: boolean }): Promise<void>;
  sidenotesFor(npc: CharacterId): { noteId: string; text: string; verbatim: boolean }[];
  /** after a render: detects verbatim echo (8+ contiguous chars) and expires ttl; appends events */
  afterRender(npc: CharacterId, generated: string): Promise<void>;
  invokeException(id: string, target: string): Promise<LedgerEntry>;
  /** whether an exception bypass is currently armed for `what` ("field_cap", "cost_due", "track_cap", "rule:<id>", "constraint:<id>") */
  bypassArmed(what: string): boolean;
  /** anchors an NPC/knowledge is referenced by (promotion + routing) */
  anchorsReferencing(ref: string): AnchorDef[];
  /** prompt note text for the currently active beat, if any */
  beatNote(): string | undefined;
}

// ───────────────────────── world ─────────────────────────
export interface WorldService {
  now(): WorldTime;
  advance(by: Duration | { to: WorldTime }, reason?: string): Promise<EngineEvent[]>;
  set(path: string, value: unknown): Promise<EngineEvent>;
  move(who: string, location: string): Promise<EngineEvent>;
  /** fire due schedule items in (from, to], update long-event phases, apply decay ticks; returns events appended */
  runSchedule(from: WorldTime, to: WorldTime): Promise<EngineEvent[]>;
  /** Lazy catch-up for a location/character since its last simulation. */
  catchUp(entity: EntityRef): Promise<EngineEvent[]>;
  interruptLongEvent(id: string): Promise<EngineEvent[]>;
  chapter(t?: WorldTime): { id: string; title?: string } | undefined;
  format(t: WorldTime): { day: number; hour: number; minute: number; hhmm: string; weekday?: string };
  toMinutes(t: WorldTime): number;
  fromMinutes(m: number): WorldTime;
  parseDuration(d: Duration): number;
}

// ───────────────────────── memory ─────────────────────────
export interface MemoryEntry {
  id: string; t: WorldTime; kind: "episodic" | "semantic" | "summary" | "reflection"; text: string; tags: string[];
  claims: { s: string; p: string; o: string }[]; importance: number; valence: number; src?: EventId; branch: string;
  shareable?: boolean; hops?: number; carriedFrom?: string;
}
export interface RetrievalHit {
  kind: "memory" | "knowledge";
  id: string;
  text: string;
  score: number;
  entry?: MemoryEntry;
  doc?: KnowledgeDoc;
  /** Developer-facing instruction (English); prompts render the localized phrase for `distortionKind`. */
  distortion?: string;
  distortionKind?: string;
}
export interface InjectedKnowledge {
  always: KnowledgeDoc[]; // static segment
  when: KnowledgeDoc[]; // dynamic segment
  index: { name: string; description: string; id: string }[]; // semi-static on-demand index (≤ indexMax)
}
export interface MemoryService {
  write(owner: CharacterId, e: Omit<MemoryEntry, "id" | "branch"> & { id?: string }): Promise<MemoryEntry | undefined>;
  list(owner: CharacterId, opts?: { includeForgotten?: boolean }): Promise<MemoryEntry[]>;
  retrieve(q: { owner: CharacterId; terms: string[]; tags?: string[]; scope?: string; location?: string; salience?: { tags: string[]; boost: number }[]; suppressTags?: string[]; ctx: CelContext; now: WorldTime; limit?: number }): Promise<RetrievalHit[]>;
  knowledge(q: { owner: CharacterId; location?: string; sceneId?: SceneId; ctx: CelContext }): InjectedKnowledge;
  readDoc(id: string): { name: string; body: string } | undefined;
  /** apply policy.memory.distortion to hits (writes memory.distorted events) */
  distort(hits: RetrievalHit[], rngKey: string): Promise<RetrievalHit[]>;
  propagateTick(): Promise<EngineEvent[]>;
  /** async at scene end: S2 reflection per principal → proposals → adjudicate → events */
  reflect(
    sceneId: SceneId,
    opts?: { defer?: boolean; /** when set, used instead of `state.scene` (e.g. after `scene.ended`) */ participants?: CharacterId[] },
  ): Promise<{ owner: CharacterId; accepted: boolean }[]>;
  /** summary text used in the semi-static segment */
  summaryFor(owner: CharacterId): Promise<string>;
  /** run reflections queued by `reflect({ defer: true })`; call at scene start */
  flushDeferred(): Promise<void>;
}

// ───────────────────────── introspect ─────────────────────────
export interface Introspect {
  query(viewer: Viewer, path: string): unknown;
  grant(viewer: Viewer, path: string, ttl?: Duration): Promise<void>;
  /** end the grants for exactly `(viewer, path)` before their TTL; writes `visibility.expired` (no-op when none is active) */
  revoke(viewer: Viewer, path: string): Promise<void>;
  explain(turnId: TurnId, viewer: Viewer): Explanation;
  registerViewer(v: ViewerDef): void;
  /** expire temp grants whose time passed (called on time.advanced) */
  expireGrants(): Promise<EngineEvent[]>;
  canRead(viewer: Viewer, path: string): boolean;
}

/**
 * Query path catalogue (all return plain JSON, filtered by visibility):
 *  characters                       → [{id,name,lod,location?,tags}]
 *  characters/<id>/{identity,constraints,traits,tracks,tiers,goals,secrets,memory,knowledge}
 *    tracks → {self:{track:value}, toward:{target:{track:value}}}; tiers → same with tier names (+ labels)
 *  world/{vars,locations,items,time,chapter,location,fields}   (world/time → {day,minute,hhmm,weekday?}; world/location → player location id)
 *  scene                            → current scene {id,location,participants,turn} | null
 *  director/anchors | director/beat (+ budget)   — `budget` → {turns, s2Turns, ...}
 *  ledger | events | timeline       (events → recent events; timeline → {branch, branches, saves})
 */

// ───────────────────────── router ─────────────────────────
export interface RouteInput {
  turn: TurnCtx;
  appraisal: Appraisal;
  anchorNear: boolean;
  fieldMaxLevel: number;
  tierChanged: boolean;
  moodDelta?: number;
  mood?: number;
  sidenoteReceived: boolean;
  sceneFirstTurn: boolean;
  secretTopic: boolean;
  contradiction: boolean;
  autonomous: boolean;
}
export interface RouteDecision { tier: "s1" | "s2"; reasons: string[]; degraded: string[] }
export interface Router {
  decide(i: RouteInput): { decision: RouteDecision; events: EventDraft[] };
  /** whether S2-only side jobs may run now (reflection, offscreen full) else degrade actions are logged */
  allow(job: "reflection" | "offscreen_narrate" | "autonomous"): { ok: boolean; events: EventDraft[] };
}

// ───────────────────────── model ─────────────────────────
// src/model/: createModelPort(spec: ModelSpec, opts?) — AI SDK adapter (anthropic/openai/google/deepseek/ollama/openai-compatible) with cache breakpoints
// via providerOptions; withRecording(port, RecordingStore) implementing record/replay (key = sha256(model id, prompt segments, params, seed));
// ScriptedModel (src/model/scripted.ts) = deterministic port driven by a handler fn (used in tests).
export type ModelFactory = (spec: import("./schema/authored.ts").ModelSpec) => ModelPort;

// ───────────────────────── kernel ─────────────────────────
/** The dependency bundle shared by modules. Fields marked (live) are getters: they change on hot reload. */
export interface EngineLocaleConfig {
  locale: string;
  promptLocale: string;
  outputLocale: string;
  contentLocale: string;
  fallbackLocale: string;
}

/**
 * Late-bound display strings (`$t:key`, `{ i18n }`) resolved against the string tables of one locale. Prompt building
 * is synchronous, so `prepare` loads the tables beforehand (the engine does it at startup and at the start of a turn).
 */
export interface DisplayText {
  /**
   * `$t:key` / `{ i18n }` values resolve; plain strings and other values pass through unchanged. Name references
   * (`{{name:<id>}}`) expand to the card names; with `localizeNames`, text shown in another language than the cards
   * are written in uses that language's spelling instead (string keys `character.<id>.name` / `.nickname` of
   * `locale`, falling back to the card name). Only UI text asks for it: prompts keep the card names.
   */
  resolve(locale: string, value: unknown, opts?: { localizeNames?: boolean }): unknown;
  /**
   * Strict lookup of one string key in exactly that locale's tables (no fallback locale), so a key translated only in
   * the fallback language is never mistaken for a translation into another language.
   */
  lookup(locale: string, key: string): string | undefined;
  /** Load string tables for these locales (idempotent). */
  prepare(locales: readonly string[]): Promise<void>;
}

export interface Kernel {
  storage: StoragePort;
  /** (live) */ authored: Authored;
  /** (live) */ policy: ResolvedPolicy;
  /** resolved UI / prompt / content locales for this engine instance */
  i18n: EngineLocaleConfig;
  /** Optional: embedders and tests without string tables omit it and prompts keep plain text as written. */
  displayText?: DisplayText;
  rules: RuleEngine;
  timeline: TimelineStore;
  models: { s1: ModelPort; s2: ModelPort };
  embedding?: EmbeddingPort;
  image?: ImagePort;
  catalog: Catalog;
  /** appends events with the current turn/scene context */
  emit(drafts: EventDraft[], ctx?: AppendCtx): Promise<EngineEvent[]>;
  /** modules resolved lazily to break cycles */
  m: {
    fields: FieldSystem;
    director: Director;
    world: WorldService;
    memory: MemoryService;
    introspect: Introspect;
    router: Router;
    entities: EntityService;
    gallery?: import("./gallery/types.ts").GalleryService & import("./gallery/types.ts").GalleryLifecycleHooks;
  };
  /** build the CEL context for an evaluation (see docs/architecture.md "CEL context") */
  celContext(p: { self?: CharacterId; other?: CharacterId; actor?: CharacterId; event?: Partial<Appraisal> & { type?: string; text?: string }; sceneId?: SceneId; check?: unknown; extra?: CelContext }): CelContext;
  warn(code: string, message: string, extra?: Record<string, unknown>): void;
  /** Serialize engine mutations; nested calls on the same stack re-enter. */
  runExclusive<T>(fn: () => Promise<T>): Promise<T>;
  acquireExclusive(): Promise<() => void>;
}
export type { PromptSegments, ModelPort, StoragePort, EmbeddingPort, CharacterState };
