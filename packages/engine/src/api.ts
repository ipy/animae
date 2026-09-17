import type { I18nConfig } from "./schema/authored.ts";
import type { EmbeddingPort, ModelMode, ModelPort, StoragePort } from "./ports.ts";
import type { PresetBundle } from "./preset.ts";
import type { ModBundle, ModSelection, ModProvenanceEntry, ResolvedMod } from "./mod.ts";
import type { FieldDef } from "./schema/authored.ts";
import type { BranchRef, Duration, EngineEvent, EntityRef, EventId, Lod, SaveSlot, SceneId, TurnChunk, TurnId, Viewer, WorldTime } from "./types.ts";
import type { ActiveScene, RuleFn, StageHook, Stage, ViewerDef, LedgerEntry, SceneReport, TimelineDiff, Explanation } from "./contracts.ts";

/** Public engine API (spec §20.1). CONTRACT file. */
export interface CreateEngineOptions {
  root: string;
  /** required unless `modelSpecs` in animae.yaml can be built from env (then engine builds AI SDK ports) */
  models?: { s1: ModelPort; s2: ModelPort };
  modelMode?: ModelMode; // default "record"
  ports?: { storage?: StoragePort; embedding?: EmbeddingPort };
  seed?: number;
  /** extra presets available to `animae.yaml: preset:` (built-ins are registered automatically only by the CLI/game; the engine package has none) */
  presets?: PresetBundle[];
  /** overrides / extends `animae.yaml` `mods:` (ids or explicit enable flags) */
  mods?: ModSelection;
  /** embedded mods (like PresetBundle); only `setup()` runs from registered bundles, never from disk */
  modBundles?: ModBundle[];
  /** wall-clock injection for tests */
  now?: () => Date;
  /** session id override (tests) */
  sessionId?: string;
  /** overrides / extends `animae.yaml` `i18n:` */
  i18n?: Partial<I18nConfig>;
}

export interface Engine {
  world: {
    now(): WorldTime;
    advance(by: Duration | { to: WorldTime }): Promise<EngineEvent[]>;
    set(path: string, value: unknown): Promise<EngineEvent>;
    /** move the player (or a character) to a location; writes `world.moved` */
    move(who: string, location: string): Promise<EngineEvent>;
  };
  scene: {
    start(s: { location: string; participants: string[]; fields?: string[] }): Promise<SceneId>;
    turn(t: {
      sceneId: SceneId;
      actor: string;
      text: string;
      addressee?: string;
      choiceId?: string;
      /** Per-turn player-facing narration language (defaults to engine `outputLocale`). */
      outputLocale?: string;
    }): AsyncIterable<TurnChunk>;
    end(sceneId: SceneId): Promise<SceneReport>;
    /**
     * The scene that is open on the current timeline right now, or `null` when none is (never started, already
     * ended, or the timeline was loaded / rewound / switched to a point without one). Reads the live projection, so
     * hosts can re-sync after any operation that replaces the timeline instead of trusting a cached scene id.
     */
    active(): ActiveScene | null;
  };
  entities: {
    generate(r: { kind: "character" | "location" | "item"; template: string; hints?: Record<string, unknown> }): Promise<EntityRef>;
    promote(id: string, to: Lod): Promise<void>;
    setAlias(input: {
      entity: string;
      nickname?: string | null;
      alias?: string;
      by: string | "player";
      target?: string;
      addressLabel?: string;
    }): Promise<void>;
    resolve(ref: string, opts?: { viewer?: string; speaker?: string; scope?: string[] }): EntityRef;
    spawn(spec: import("./entities/spawn.ts").SpawnEntitySpec, opts?: { reason?: string; id?: string }): Promise<EntityRef>;
    retire(ref: string, opts?: { reason?: string }): Promise<void>;
    generateFromBrief(
      brief: import("./entities/generate-brief.ts").GenerationBrief,
      opts?: { pools?: import("./entities/generate-brief.ts").GenerationPools; reason?: string },
    ): Promise<EntityRef>;
  };
  /** Alias for `entities.setAlias`. */
  setAlias(input: {
    entity: string;
    nickname?: string | null;
    alias?: string;
    by: string | "player";
    target?: string;
    addressLabel?: string;
  }): Promise<void>;
  /** Alias for `entities.resolve`. */
  resolveEntity(ref: string, opts?: { viewer?: string; speaker?: string; scope?: string[] }): EntityRef;
  /** Alias for `entities.spawn`. */
  spawnEntity(spec: import("./entities/spawn.ts").SpawnEntitySpec, opts?: { reason?: string; id?: string }): Promise<EntityRef>;
  fields: { declare(f: FieldDef): void; grant(f: FieldDef): Promise<LedgerEntry>; revoke(id: string): Promise<void> };
  director: {
    sidenote(npc: string, text: string, o?: { ttlTurns?: number; verbatim?: boolean }): Promise<void>;
    invokeException(id: string, target: string): Promise<LedgerEntry>;
  };
  timeline: {
    current(): BranchRef;
    save(label?: string): Promise<SaveSlot>;
    load(slot: SaveSlot | string): Promise<void>;
    rewind(to: EventId): Promise<BranchRef>;
    branches(): Promise<BranchRef[]>;
    switch(b: BranchRef | string): Promise<void>;
    diff(a: BranchRef | string, b: BranchRef | string): Promise<TimelineDiff>;
    prune(b: BranchRef | string): Promise<void>;
    export(b: BranchRef | string, o?: { recordings?: boolean; file?: string }): Promise<string>;
    import(file: string): Promise<BranchRef>;
    replay(b: BranchRef | string, r?: { from?: EventId; to?: EventId }): AsyncIterable<TurnChunk>;
    saves(): Promise<SaveSlot[]>;
    /** events of the current chain (visibility NOT applied; for engine/CLI internals — UIs should use `query`) */
    events(opts?: { from?: EventId; kinds?: string[]; limit?: number }): Promise<EngineEvent[]>;
  };
  rules: { register(name: string, fn: RuleFn): void };
  hooks: { register(stage: Stage, fn: StageHook): void };
  introspect: { registerViewer(v: ViewerDef): void };
  /** synchronous read of in-memory projection, filtered by viewer + visibility policy */
  query(viewer: Viewer, path: string): unknown;
  /** like `query`, but runs §12.6 lazy catch-up for stale player location/character paths first */
  queryAsync(viewer: Viewer, path: string): Promise<unknown>;
  grant(viewer: Viewer, path: string, ttl?: Duration): Promise<void>;
  explain(turnId: TurnId, viewer: Viewer): Explanation;
  on(kind: string, h: (e: EngineEvent) => void): () => void;
  purge(scope: { characters?: string[]; memoryIds?: string[]; sessions?: string[] }): Promise<void>;
  importCard(file: string): Promise<string>;
  exportCard(id: string): Promise<string>;
  /** validates and (re)loads authored files; returns warnings */
  reload(): Promise<{ ok: boolean; errors: string[]; warnings: string[] }>;
  /** Switch UI/display string locale at runtime (does not reload content overlays or prompt scaffolding). */
  setUiLocale(locale: string): void;
  /** Resolve authored `$t:` / `{ i18n }` and catalog keys at a viewer UI locale. */
  display: {
    resolve(value: unknown, opts?: { locale?: string }): unknown;
    entityDisplayName(entityId: string, opts?: { viewer?: string; speaker?: string; locale?: string }): string;
  };
  /** read-only info useful for UIs (not visibility filtered; contains no hidden state): engine/preset ids, language, models ids */
  info(): {
    preset?: string;
    language: string;
    locale: string;
    promptLocale: string;
    outputLocale: string;
    contentLocale: string;
    branch: string;
    sessionId: string;
    models: { s1: string; s2: string };
    modelMode: ModelMode;
  };
  /** enabled mods with provenance; `drift` when timeline record differs from current set */
  mods(): { mods: ResolvedMod[]; drift: boolean; driftMessage?: string; provenance: Record<string, ModProvenanceEntry> };
  close(): Promise<void>;
}

export type CreateEngine = (opts: CreateEngineOptions) => Promise<Engine>;
