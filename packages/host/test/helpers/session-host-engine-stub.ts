import type {
  ActiveScene,
  Engine,
  EventId,
  GalleryItemView,
  GalleryNotice,
  SceneId,
  TurnId,
  Viewer,
} from "@animae/engine";

export type SessionHostTestEngineOptions = {
  /** Replaces `engine.scene.turn` (same signature as the real engine). */
  turn?: Engine["scene"]["turn"];
  /** When set, replaces `engine.scene.active` (default: open tavern scene). */
  sceneActive?: () => ActiveScene | null;
};

const shotA: GalleryItemView = {
  id: "shot-a",
  kind: "preset",
  title: "Portrait",
  order: 1,
  rating: "general",
  available: true,
  unlocked: true,
  characters: [],
  tags: [],
};

function galleryService(): Engine["gallery"] {
  return {
    subscribe: (fn: (n: GalleryNotice) => void) => {
      fn({ type: "changed", item: "shot-a" });
      fn({ type: "unlocked", item: "shot-a" });
      return () => {};
    },
    list: async () => [],
    get: async (id: string) => (id === "shot-a" ? shotA : undefined),
    ratings: () => [],
    jobs: () => [],
    generatorAvailable: () => true,
    capture: async () => ({ item: "i", job: "j" }),
    render: async () => ({ job: "j" }),
    cancel: async () => true,
    remove: async () => {},
    pin: async () => {},
    unlock: async () => shotA,
    image: async () => undefined,
  };
}

const defaultSceneActive = (): ActiveScene => ({
  id: "scn_1" as SceneId,
  location: "tavern",
  participants: ["player", "npc1"],
  turn: 1,
});

const emptyTurn: Engine["scene"]["turn"] = async function* () {};

/** Partial engine for SessionHost command/input tests; cast once at the boundary. */
export function createSessionHostTestEngine(options: SessionHostTestEngineOptions = {}): Engine {
  const engine = {
    gallery: galleryService(),
    on: () => () => {},
    query: (_viewer: Viewer, path: string) => {
      if (path === "scene") return { participants: ["player", "npc1"] };
      if (path === "world/location") return "tavern";
      if (path === "director/beat") return { label: "beat" };
      if (path === "budget") throw new Error("hidden");
      if (path === "characters") return [];
      return undefined;
    },
    queryAsync: async (_viewer: Viewer, path: string) => (path === "async/path" ? { ok: true } : undefined),
    world: { now: () => ({ day: 2, minute: 90 }) },
    scene: {
      active: options.sceneActive ?? defaultSceneActive,
      start: async () => "scn_2" as SceneId,
      end: async () => ({
        sceneId: "scn_1" as SceneId,
        turns: 0,
        events: 0,
        reflections: [],
        anchors: [],
      }),
      turn: options.turn ?? emptyTurn,
    },
    mods: () => ({ mods: [], drift: false, provenance: {} }),
    timeline: {
      current: () => ({ name: "main" }),
      save: async () => ({ label: "s", eventId: "e" as EventId, branch: "main", createdAt: "" }),
    },
    explain: () => ({ turnId: "t" as TurnId, viewer: "player" as Viewer, chain: [] }),
    modelCallLog: undefined,
    info: () => ({
      root: "/mem",
      language: "en",
      locale: "en",
      promptLocale: "en",
      outputLocale: "en",
      contentLocale: "en",
      branch: "main",
      sessionId: "s",
      models: { s1: "rule", s2: "rule", s2Tiers: [] },
      mode: { appraise: "rule", render: "rule" },
      modelMode: "record",
    }),
  };
  return engine as unknown as Engine;
}

export function sessionHostEngineNoScene(options: Omit<SessionHostTestEngineOptions, "sceneActive"> = {}): Engine {
  return createSessionHostTestEngine({ ...options, sceneActive: () => null });
}
