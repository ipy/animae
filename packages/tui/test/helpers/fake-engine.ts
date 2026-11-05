import type { Engine } from "@animae/engine";
import { RUNTIME_MODE_PRESET_VALUES } from "@animae/engine";
import type {
  ActiveScene,
  EngineEvent,
  ModelsInfo,
  RuntimeMode,
  RuntimeModeRequest,
  SwitchAt,
  TurnChunk,
  TurnId,
} from "@animae/engine";

/** What the fake engine's runtime reports and how it behaves when asked to switch. */
export interface FakeRuntimeOptions {
  mode?: RuntimeMode;
  models?: Partial<ModelsInfo>;
  switchAt?: SwitchAt;
  /** Queue switch requests like a running turn would (they apply when `applyQueued` runs). */
  queueSwitches?: boolean;
}

export interface TuiFakeEngineControls {
  engine: Engine;
  /** Deliver an engine event to the listeners registered with `engine.on`. */
  emit: (kind: string, partial?: Partial<EngineEvent>) => EngineEvent;
  /** Apply the queued mode change, as the engine does at the turn boundary. */
  applyQueued: () => void;
}

export function createTuiFakeEngine(overrides: Partial<Engine> = {}, runtime: FakeRuntimeOptions = {}): Engine {
  return createTuiFakeEngineControls(overrides, runtime).engine;
}

export function createTuiFakeEngineControls(
  overrides: Partial<Engine> = {},
  runtimeOptions: FakeRuntimeOptions = {},
): TuiFakeEngineControls {
  const listeners = new Map<string, Set<(e: EngineEvent) => void>>();

  const emit = (kind: string, partial: Partial<EngineEvent> = {}) => {
    const e = {
      id: `evt_${listeners.size}`,
      kind,
      t: { day: 1, minute: 0 },
      sid: "s1",
      source: "test",
      because: [],
      ...partial,
    } as EngineEvent;
    listeners.get(kind)?.forEach((h) => h(e));
    return e;
  };

  const queryData: Record<string, unknown> = {
    "world/time": { day: 1, minute: 480, hhmm: "08:00" },
    "world/location": "café",
    "world/chapter": { id: "prologue", title: "Prologue" },
    scene: { id: "scn_0001", location: "café", participants: ["player", "mira"] },
    timeline: { branch: "main", branches: ["main"], saves: [] },
    budget: { turns: 3, s2Turns: 1 },
  };

  let runtimeMode: RuntimeMode = { ...(runtimeOptions.mode ?? { appraise: "llm", render: "llm" }) };
  let queuedMode: RuntimeMode | null = null;
  const modelsInfo: ModelsInfo = {
    s1: "s1",
    s2: "s2",
    s1Llm: true,
    s2Tiers: [{ id: "only", model: "s2", tags: [] }],
    s2Default: "only",
    ...runtimeOptions.models,
  };
  const nextMode = (req: Parameters<Engine["runtime"]["setMode"]>[0], from: RuntimeMode): RuntimeMode => {
    if (typeof req === "string") return { ...RUNTIME_MODE_PRESET_VALUES[req] };
    const partial: RuntimeModeRequest = req;
    return {
      appraise: partial.appraise ?? from.appraise,
      render: partial.render ?? from.render,
      ...(partial.s2Tier ? { s2Tier: partial.s2Tier } : from.s2Tier ? { s2Tier: from.s2Tier } : {}),
    };
  };
  const applyMode = (next: RuntimeMode) => {
    const before = { ...runtimeMode };
    runtimeMode = { ...next };
    emit("runtime.mode_changed", { before, after: { ...runtimeMode }, reason: "api" } as Partial<EngineEvent>);
  };

  let openScene: ActiveScene | null = { id: "scn_0001", location: "café", participants: ["player", "mira"], turn: 0 };

  const base: Engine = {
    world: {
      now: () => ({ day: 1, minute: 480 }),
      advance: async () => {
        emit("time.advanced");
        return [];
      },
      set: async () => emit("world.var_set") as EngineEvent,
      move: async () => emit("world.moved") as EngineEvent,
    },
    scene: {
      start: async (s) => {
        openScene = { id: "scn_0001", location: s.location, participants: [...s.participants], turn: 0 };
        return "scn_0001";
      },
      active: () => openScene,
      turn: async function* (): AsyncGenerator<TurnChunk> {
        yield { type: "text", text: "Bonjour, le monde!", speaker: "mira" };
        yield {
          type: "cue",
          cue: { type: "expression", args: { name: "smile" } },
          at: 0,
          speaker: "mira",
        };
        yield { type: "done", turnId: "turn_0001" as TurnId, events: ["evt_1"] };
      },
      end: async () => {
        openScene = null;
        return {
          sceneId: "scn_0001",
          turns: 1,
          events: 1,
          reflections: [],
          anchors: [],
        };
      },
    },
    entities: {
      generate: async () => ({ kind: "character", id: "gen_1" }),
      promote: async () => {},
      setAlias: async () => {},
      resolve: (ref) => ({ kind: "character", id: ref }),
      spawn: async () => ({ kind: "character", id: "dyn-0001" }),
      retire: async () => {},
      generateFromBrief: async () => ({ kind: "character", id: "dyn-0002" }),
    },
    setAlias: async () => {},
    resolveEntity: (ref) => ({ kind: "character", id: ref }),
    spawnEntity: async () => ({ kind: "character", id: "dyn-0001" }),
    fields: {
      declare: () => {},
      grant: async () => ({ eventId: "evt_0001", kind: "field.granted", field: "f1", detail: { holder: "player", level: "L0" } }),
      revoke: async () => {},
    },
    director: { sidenote: async () => {}, invokeException: async () => ({ eventId: "evt_0001", kind: "exception.used", field: "ex", detail: { holder: "npc", level: "L0" } }) },
    timeline: {
      current: () => ({ name: "main" }),
      save: async (label?: string) => ({
        label: label?.trim() || "quicksave",
        branch: "main",
        eventId: "evt_0",
        createdAt: new Date().toISOString(),
      }),
      load: async () => {},
      rewind: async () => ({ name: "main" }),
      branches: async () => [{ name: "main" }, { name: "fork-a" }],
      switch: async () => {},
      diff: async () => ({ state: [], events: { onlyA: [], onlyB: [] } }),
      prune: async () => {},
      export: async () => "/tmp/out.json",
      import: async () => ({ name: "main" }),
      replay: async function* (): AsyncGenerator<TurnChunk> {
        yield { type: "text", text: "replay" };
        yield { type: "done", turnId: "turn_0002" as TurnId, events: ["evt_3"] };
      },
      saves: async () => [],
      events: async () => [
        { id: "evt_0", kind: "scene.started", t: { day: 1, minute: 0 }, sid: "s1", source: "t", because: [] },
        { id: "evt_1", kind: "utterance", t: { day: 1, minute: 0 }, sid: "s1", source: "t", because: [] },
      ],
    },
    rules: { register: () => {} },
    hooks: { register: () => {} },
    introspect: { registerViewer: () => {} },
    query: (_viewer, path) => queryData[path] ?? null,
    queryAsync: async (_viewer, path) => queryData[path] ?? null,
    grant: async () => {},
    revoke: async () => {},
    explain: () => ({
      turnId: "turn_0001" as TurnId,
      viewer: "player",
      chain: [{ eventId: "evt_1", kind: "utterance", summary: " spoke" }],
    }),
    on(kind: string, h: (e: EngineEvent) => void) {
      if (!listeners.has(kind)) listeners.set(kind, new Set());
      listeners.get(kind)!.add(h);
      return () => listeners.get(kind)?.delete(h);
    },
    purge: async () => {},
    importCard: async () => "char_1",
    exportCard: async () => "/tmp/card.acard.jsonl",
    reload: async () => ({ ok: true, errors: [], warnings: [] }),
    mods: () => ({ mods: [], drift: false, provenance: {} }),
    setUiLocale: () => {},
    display: { resolve: (v) => v, entityDisplayName: (id) => id },
    info: () => ({
      root: "/tmp",
      language: "en",
      locale: "en",
      promptLocale: "en",
      outputLocale: "en",
      contentLocale: "en",
      branch: "main",
      sessionId: "sess",
      models: modelsInfo,
      mode: { ...runtimeMode },
      modelMode: "record",
    }),
    runtime: {
      mode: () => ({ ...runtimeMode }),
      pending: () => (queuedMode ? { ...queuedMode } : null),
      switchAt: runtimeOptions.switchAt ?? "turn_boundary",
      setMode: async (req) => {
        const before = { ...runtimeMode };
        const next = nextMode(req, queuedMode ?? runtimeMode);
        const same = next.appraise === before.appraise && next.render === before.render && next.s2Tier === before.s2Tier;
        if (same) {
          queuedMode = null;
          return { before, after: before, pending: false };
        }
        if (runtimeOptions.queueSwitches) {
          queuedMode = next;
          return { before, after: { ...next }, pending: true };
        }
        applyMode(next);
        return { before, after: { ...runtimeMode }, pending: false };
      },
      models: () => modelsInfo,
    },
    gallery: {
      generatorAvailable: () => false,
      ratings: () => [],
      list: async () => [],
      get: async () => undefined,
      unlock: async () => {
        throw new Error("gallery stub");
      },
      capture: async () => {
        throw new Error("gallery stub");
      },
      render: async () => {
        throw new Error("gallery stub");
      },
      cancel: async () => false,
      remove: async () => {},
      pin: async () => {},
      image: async () => undefined,
      jobs: () => [],
      subscribe: () => () => {},
    },
    close: async () => {},
  };

  return {
    engine: { ...base, ...overrides },
    emit,
    applyQueued: () => {
      if (!queuedMode) return;
      const next = queuedMode;
      queuedMode = null;
      applyMode(next);
    },
  };
}
