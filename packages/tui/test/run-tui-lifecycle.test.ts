import { describe, expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { runTui } from "../src/run-tui.ts";
import { createTuiFakeEngine } from "./helpers/fake-engine.ts";
import { waitMs } from "./helpers/ink-harness.ts";

class MockTtyIn extends PassThrough {
  isTTY = true;
  setRawMode(_mode: boolean): void {}
}

describe("runTui lifecycle", () => {
  test("uses preparsed stdin when underlying stream is a TTY", async () => {
    const engine = createTuiFakeEngine();
    const stdin = new MockTtyIn();
    const stdout = Object.assign(new PassThrough(), { columns: 80, rows: 24, isTTY: true });
    const stderr = new PassThrough();
    const done = runTui({
      engine,
      scene: { sceneId: "scn_0001" },
      stdin,
      stdout,
      stderr,
      mouse: false,
    });
    stdin.end();
    await done;
  });

  test("terminal shutdown race resolves without hanging", async () => {
    const engine = createTuiFakeEngine();
    let closed = false;
    const wrapped = {
      ...engine,
      close: async () => {
        closed = true;
      },
    };
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const done = runTui({
      engine: wrapped,
      scene: { sceneId: "scn_0001" },
      stdin,
      stdout,
      stderr,
      mouse: false,
    });
    await waitMs(40);
    stdin.emit("end");
    await done;
    expect(closed).toBe(true);
  });
});
