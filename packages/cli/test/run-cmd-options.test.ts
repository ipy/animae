import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, expect, test } from "bun:test";
import { runInit } from "../src/commands/init.ts";
import { withCapturedStdout } from "./helpers/io.ts";

let dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
  dirs = [];
});

async function loadRunCmd() {
  return import("../src/commands/run-cmd.ts");
}

test("runRunCommand --plain picks default scene when --scene omitted", async () => {
  const dir = await mkdtemp(join(tmpdir(), "animae-run-loc-"));
  dirs.push(dir);
  await runInit({ dir, preset: "@animae/preset-rule" });
  const input = Readable.from([":quit\n"]);
  const origStdin = process.stdin;
  Object.defineProperty(process, "stdin", { value: input, configurable: true });
  try {
    const { runRunCommand } = await loadRunCmd();
    const { code } = await withCapturedStdout(() =>
      runRunCommand({ root: dir, mode: "rule", plain: true }),
    );
    expect(code).toBe(0);
  } finally {
    Object.defineProperty(process, "stdin", { value: origStdin, configurable: true });
  }
});

test("runRunCommand surfaces scene.start failures after engine open", async () => {
  const dir = await mkdtemp(join(tmpdir(), "animae-run-scene-fail-"));
  dirs.push(dir);
  await runInit({ dir, preset: "@animae/preset-rule" });
  const { runRunCommand } = await loadRunCmd();
  const { code, err } = await withCapturedStdout(() =>
    runRunCommand({ root: dir, mode: "rule", plain: true, scene: "" }),
  );
  expect(code).toBe(1);
  expect(err.length).toBeGreaterThan(0);
});
