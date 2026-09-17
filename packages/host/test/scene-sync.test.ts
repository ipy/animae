import { describe, expect, test } from "bun:test";
import type { ActiveScene, Engine } from "@animae/engine";
import { createHostCommandApi, syncSceneFromEngine, type CommandApiState } from "../src/command-api.ts";

/** Minimal engine double whose open scene the test controls (as `timeline.load` / `rewind` would). */
function engineWith(initial: ActiveScene | null) {
  let open = initial;
  const ended: string[] = [];
  const engine = {
    scene: {
      active: () => (open ? { ...open, participants: [...open.participants] } : null),
      start: async (s: { location: string; participants: string[] }) => {
        open = { id: "scn_0002", location: s.location, participants: [...s.participants], turn: 0 };
        return "scn_0002";
      },
      end: async (id: string) => {
        if (!open || open.id !== id) throw Object.assign(new Error("Scene not active"), { code: "SCENE_INVALID" });
        ended.push(id);
        open = null;
        return {};
      },
    },
  } as unknown as Engine;
  return {
    engine,
    ended,
    replaceOpenScene(next: ActiveScene | null) {
      open = next;
    },
  };
}

const noop = () => {};
const uiBridge = { openOverlay: noop, closeOverlay: noop, setMouseCapture: noop };
const scene = (id: string, participants = ["player", "npc1"]): ActiveScene => ({
  id,
  location: "tavern",
  participants,
  turn: 3,
});

describe("host scene sync", () => {
  test("syncSceneFromEngine adopts, replaces and clears the cached scene", () => {
    const { engine, replaceOpenScene } = engineWith(scene("scn_0001"));
    const state: CommandApiState = {};

    syncSceneFromEngine(engine, state, "player");
    expect(state).toEqual({ sceneId: "scn_0001", sceneParticipants: ["npc1"] });

    replaceOpenScene(scene("scn_0007", ["player", "npc2", "npc3"]));
    syncSceneFromEngine(engine, state, "player");
    expect(state).toEqual({ sceneId: "scn_0007", sceneParticipants: ["npc2", "npc3"] });

    replaceOpenScene(null);
    syncSceneFromEngine(engine, state, "player");
    expect(state.sceneId).toBeUndefined();
    expect(state.sceneParticipants).toBeUndefined();
  });

  test("engines without scene.active keep the cached value", () => {
    const engine = { scene: {} } as unknown as Engine;
    const state: CommandApiState = { sceneId: "scn_0001", sceneParticipants: ["npc1"] };
    syncSceneFromEngine(engine, state, "player");
    expect(state).toEqual({ sceneId: "scn_0001", sceneParticipants: ["npc1"] });
  });

  test("sceneId() reports the engine's scene after the timeline replaced it", () => {
    const { engine, replaceOpenScene } = engineWith(scene("scn_0001"));
    const api = createHostCommandApi(engine, "player", "player", {}, noop, uiBridge);
    expect(api.sceneId()).toBe("scn_0001");
    replaceOpenScene(null);
    expect(api.sceneId()).toBeUndefined();
  });

  test("endScene() does not throw for a scene the engine no longer has, and ends the live one otherwise", async () => {
    const { engine, ended, replaceOpenScene } = engineWith(scene("scn_0001"));
    const state: CommandApiState = {};
    const api = createHostCommandApi(engine, "player", "player", state, noop, uiBridge);
    expect(api.sceneId()).toBe("scn_0001");

    // A load drops the scene: ending it is a no-op (it used to throw SCENE_INVALID and wedge "end day").
    replaceOpenScene(null);
    await api.endScene();
    expect(ended).toEqual([]);
    expect(state.sceneId).toBeUndefined();

    // A load swaps in a different scene: the live one is ended, not the stale id.
    replaceOpenScene(scene("scn_0009"));
    await api.endScene();
    expect(ended).toEqual(["scn_0009"]);
    expect(api.sceneId()).toBeUndefined();
  });

  test("startScene() then sceneId() agree with the engine", async () => {
    const { engine } = engineWith(null);
    const api = createHostCommandApi(engine, "player", "player", {}, noop, uiBridge);
    expect(api.sceneId()).toBeUndefined();
    const id = await api.startScene({ location: "tavern", participants: ["player", "npc1"] });
    expect(id).toBe("scn_0002");
    expect(api.sceneId()).toBe("scn_0002");
  });
});
