import { describe, expect, test } from "bun:test";
import { createHostCommandApi, setHostSceneId } from "../src/command-api.ts";
import { createCommandApiBridgeTestEngine } from "./helpers/command-api-bridge-engine-stub.ts";

describe("createHostCommandApi UI bridge", () => {
  const engine = createCommandApiBridgeTestEngine();

  test("forwards overlay, locale, t, and openFile", () => {
    let overlay: string | undefined;
    let capture: string | undefined;
    const api = createHostCommandApi(
      engine,
      "player",
      "player",
      {},
      () => {},
      {
        openOverlay: (n) => {
          overlay = n;
        },
        closeOverlay: () => {
          overlay = undefined;
        },
        setMouseCapture: () => {},
      },
      { locale: () => "fr", t: (k) => `T:${k}` },
      async (path) => {
        capture = path;
      },
      () => "focus-1",
    );
    api.openOverlay("x");
    expect(overlay).toEqual("x");
    expect(api.locale?.()).toBe("fr");
    expect(api.t?.("key")).toBe("T:key");
    expect(api.focusTarget?.()).toBe("focus-1");
    void api.openFile?.("/tmp/a");
    expect(capture).toBe("/tmp/a");
    const state = { sceneId: "scn_y" as string | undefined };
    setHostSceneId(state, "scn_y");
    expect(state.sceneId).toBe("scn_y");
  });
});
