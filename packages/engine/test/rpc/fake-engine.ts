import type { Engine } from "../../src/api.ts";
import type { EngineEvent, TurnChunk, TurnId } from "../../src/types.ts";

export function createFakeEngine(overrides: Partial<Engine> = {}): Engine {
  const listeners = new Map<string, Set<(e: EngineEvent) => void>>();

  const emit = (kind: string, partial: Partial<EngineEvent> = {}) => {
    const e = { id: "evt_0001", kind, t: { day: 1, minute: 0 }, sid: "s1", source: "test", because: [], ...partial } as EngineEvent;
    listeners.get(kind)?.forEach((h) => h(e));
  };

  const base: Engine = {
    world: {
      now: () => ({ day: 1, minute: 480 }),
      advance: async () => [],
      set: async () => {
        emit("world.var_set");
        return { id: "evt_0001", kind: "world.var_set", t: { day: 1, minute: 0 }, sid: "s1", source: "test", because: [] };
      },
      move: async () => {
        emit("world.moved");
        return { id: "evt_0001", kind: "world.moved", t: { day: 1, minute: 0 }, sid: "s1", source: "test", because: [] };
      },
    },
    scene: {
      start: async () => "scn_0001",
      turn: async function* (): AsyncGenerator<TurnChunk> {
        yield { type: "text", text: "hi" };
        yield { type: "done", turnId: "turn_0001" as TurnId, events: ["evt_0002"] };
      },
      end: async () => ({ sceneId: "scn_0001", turns: 1, events: 1, reflections: [], anchors: [] }),
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
    director: {
      sidenote: async () => {},
      invokeException: async () => ({ eventId: "evt_0001", kind: "exception.used", field: "ex", detail: { holder: "npc", level: "L0" } }),
    },
    timeline: {
      current: () => ({ name: "main" }),
      save: async () => ({ label: "s", branch: "main", eventId: "evt_0001", createdAt: new Date().toISOString() }),
      load: async () => {},
      rewind: async () => ({ name: "main" }),
      branches: async () => [{ name: "main" }],
      switch: async () => {},
      diff: async () => ({ state: [], events: { onlyA: [], onlyB: [] } }),
      prune: async () => {},
      export: async () => "/tmp/out.json",
      import: async () => ({ name: "main" }),
      replay: async function* (): AsyncGenerator<TurnChunk> {
        yield { type: "text", text: "replay" };
        yield { type: "done", turnId: "turn_0002" as TurnId, events: ["evt_0003"] };
      },
      saves: async () => [],
      events: async () => [],
    },
    rules: { register: () => {} },
    hooks: { register: () => {} },
    introspect: { registerViewer: () => {} },
    query: () => ({ ok: true }),
    queryAsync: async () => ({ ok: true }),
    grant: async () => {},
    explain: () => ({ turnId: "turn_0001" as TurnId, viewer: "player", chain: [] }),
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
    info: () => ({
      language: "en",
      locale: "en",
      promptLocale: "zh-CN",
      outputLocale: "en",
      contentLocale: "en",
      branch: "main",
      sessionId: "sess",
      models: { s1: "s1", s2: "s2" },
      modelMode: "record",
    }),
    close: async () => {},
  };

  return { ...base, ...overrides };
}
