import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { runInit } from "../src/commands/init.ts";
import { runModsExplain, runModsList, runModsValidate } from "../src/commands/mods.ts";
import { withCapturedStdout } from "./helpers/io.ts";

let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "animae-mods-cmd-"));
  await runInit({ dir, preset: "@animae/preset-rule" });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("mods list and validate on init skeleton", async () => {
  const list = await withCapturedStdout(() => runModsList(dir));
  expect(list.code).toBe(0);

  const val = await withCapturedStdout(() => runModsValidate(dir));
  expect(val.code).toBe(0);
  expect(val.out).toContain("OK");
});

test("mods explain reports missing path", async () => {
  const { code, out } = await withCapturedStdout(() => runModsExplain(dir, "world/missing.yaml"));
  expect(code).toBe(1);
  expect(out).toContain("not loaded");
});

test("mods validate fails on unknown mod id", async () => {
  const { code, err } = await withCapturedStdout(() => runModsValidate(dir, ["does-not-exist-mod"]));
  expect(code).toBe(1);
  expect(err.length).toBeGreaterThan(0);
});
