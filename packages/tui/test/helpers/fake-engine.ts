import type { Engine } from "@animae/engine";
import type { ActiveScene, EngineEvent, TurnChunk, TurnId } from "@animae/engine";

export function createTuiFakeEngine(overrides: Partial<Engine> = {}): Engine {
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
        yield { type: "text", text: "你好，世界。", speaker: "mira" };
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
      save: async () => ({ label: "quicksave", branch: "main", eventId: "evt_0", createdAt: new Date().toISOString() }),
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
      language: "zh",
      locale: "en",
      promptLocale: "zh-CN",
      outputLocale: "zh",
      contentLocale: "zh",
      branch: "main",
      sessionId: "sess",
      models: { s1: "s1", s2: "s2" },
      modelMode: "record",
    }),
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

  return { ...base, ...overrides };
}
