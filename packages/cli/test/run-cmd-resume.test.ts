import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { runInit } from "../src/commands/init.ts";
import { runRunCommand, type RunCommandOptions } from "../src/commands/run-cmd.ts";
import { withCapturedStdout } from "./helpers/io.ts";

let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "animae-run-resume-"));
  await runInit({ dir, preset: "@animae/preset-rule" });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** One `run --plain` session reading `lines` from stdin. */
async function session(lines: string[], extra: Partial<RunCommandOptions> = {}) {
  const origStdin = process.stdin;
  Object.defineProperty(process, "stdin", { value: Readable.from(lines), configurable: true });
  try {
    return await withCapturedStdout(() => runRunCommand({ root: dir, mode: "rule", plain: true, ...extra }));
  } finally {
    Object.defineProperty(process, "stdin", { value: origStdin, configurable: true });
  }
}

async function loggedKinds(): Promise<string[]> {
  const raw = await readFile(join(dir, "timelines/main/events.jsonl"), "utf8");
  return raw
    .trim()
    .split("\n")
    .map((line) => (JSON.parse(line) as { kind: string }).kind);
}

test("a later run resumes the scene the previous session left open", async () => {
  expect((await session(["hello one\n", ":quit\n"], { scene: "home" })).code).toBe(0);
  // Without --scene, and again with the same --scene: both continue the open scene.
  expect((await session(["hello two\n", ":quit\n"])).code).toBe(0);
  expect((await session(["hello three\n", ":quit\n"], { scene: "home" })).code).toBe(0);

  const kinds = await loggedKinds();
  expect(kinds.filter((k) => k === "scene.started")).toHaveLength(1);
  expect(kinds.filter((k) => k === "input.received")).toHaveLength(3);
  expect(kinds.filter((k) => k === "turn.ended")).toHaveLength(3);
});

test("asking for another location while a scene is open is refused, not silently replaced", async () => {
  expect((await session([":quit\n"], { scene: "home" })).code).toBe(0);
  const { code, err } = await session([":quit\n"], { scene: "somewhere-else" });
  expect(code).toBe(1);
  expect(err).toMatch(/already active/i);
  expect((await loggedKinds()).filter((k) => k === "scene.started")).toHaveLength(1);
});

test("a --with participant that is not in the open scene is refused", async () => {
  expect((await session([":quit\n"], { scene: "home" })).code).toBe(0);
  const { code, err } = await session([":quit\n"], { scene: "home", withIds: ["someone-new"] });
  expect(code).toBe(1);
  expect(err).toMatch(/already active/i);
});
