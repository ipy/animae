import type { Duration, Engine, EventId, SaveSlot, TurnId, Viewer, WorldTime } from "@animae/engine";
import type { HostCommandApi } from "../../src/types.ts";

export type HostCommandApiTestStub = HostCommandApi & { notes: string[]; overlays: string[] };

export type BuiltinCommandsTestEnginePatch = {
  timeline?: Partial<Engine["timeline"]>;
  query?: Engine["query"];
  world?: Partial<Engine["world"]>;
  explain?: Engine["explain"];
  gallery?: Partial<Engine["gallery"]>;
};

function createBuiltinCommandsTestEngine(patch: BuiltinCommandsTestEnginePatch = {}): Engine {
  const timeline = {
    save: async (label?: string): Promise<SaveSlot> => ({
      label: label ?? "auto",
      eventId: "ev_1" as EventId,
      branch: "main",
      createdAt: "",
    }),
    load: async (_slot: string) => {},
    rewind: async (_id: EventId) => ({ name: "main" }),
    branches: async () => [{ name: "main" }, { name: "alt" }],
    ...patch.timeline,
  };
  const gallery = {
    list: async () => [],
    ratings: () => [],
    jobs: () => [],
    get: async () => undefined,
    capture: async () => ({ item: "i", job: "j" }),
    render: async () => ({ job: "j" }),
    cancel: async () => true,
    remove: async () => {},
    pin: async () => {},
    unlock: async () => {
      throw new Error("not used");
    },
    image: async () => undefined,
    subscribe: () => () => {},
    generatorAvailable: () => false,
    ...patch.gallery,
  };
  const engine = {
    timeline,
    explain: patch.explain ??
      ((_turn: TurnId, _viewer: Viewer) => ({
        turnId: "turn_1" as TurnId,
        viewer: "player" as Viewer,
        chain: [{ eventId: "ev_1" as EventId, kind: "step", summary: "step" }],
      })),
    query:
      patch.query ??
      ((_viewer: Viewer, path: string) => (path === "world/vars/x" ? 42 : null)),
    world: {
      advance: async (_by: Duration | { to: WorldTime }) => [],
      ...patch.world,
    },
    gallery,
    modelCallLog: undefined,
    info: () => ({ root: "/mem" }),
  };
  return engine as unknown as Engine;
}

/** Host command API double for builtin-command tests (engine cast once inside). */
export function createHostCommandApiStub(
  overrides: Partial<HostCommandApi> & { enginePatch?: BuiltinCommandsTestEnginePatch } = {},
): HostCommandApiTestStub {
  const notes: string[] = [];
  const overlays: string[] = [];
  const { enginePatch, engine: engineOverride, ...rest } = overrides;
  const engine = engineOverride ?? createBuiltinCommandsTestEngine(enginePatch);
  return {
    engine,
    viewer: "player",
    actor: "player",
    sceneId: () => "scn_1",
    startScene: async () => "scn_1",
    endScene: async () => {},
    notify: (text) => notes.push(typeof text === "string" ? text : JSON.stringify(text)),
    openOverlay: (name) => overlays.push(name),
    closeOverlay: () => {},
    setMouseCapture: () => {},
    locale: () => "en",
    t: (k) => k,
    notes,
    overlays,
    ...rest,
  };
}

export { createBuiltinCommandsTestEngine };
