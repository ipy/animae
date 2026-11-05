import { describe, expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { runTui } from "../src/run-tui.ts";
import { createTuiFakeEngine } from "./helpers/fake-engine.ts";

describe("runTui", () => {
  test("unmounts when stdin ends (injected streams, no real TTY)", async () => {
    const engine = createTuiFakeEngine();
    let closed = false;
    const engineWithClose = {
      ...engine,
      close: async () => {
        closed = true;
      },
    };
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const done = runTui({
      engine: engineWithClose,
      scene: { sceneId: "scn_0001" },
      stdin,
      stdout,
      stderr,
      mouse: false,
    });
    stdin.emit("end");
    await done;
    expect(closed).toBe(true);
  });

});
