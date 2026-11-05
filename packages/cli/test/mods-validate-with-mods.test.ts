import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "bun:test";
import { runInit } from "../src/commands/init.ts";
import { runModsExplain, runModsList, validateWithMods } from "../src/commands/mods.ts";
import { withCapturedStdout } from "./helpers/io.ts";

let dir = "";

afterEach(async () => {
  if (dir) {
    await rm(dir, { recursive: true, force: true });
    dir = "";
  }
});

test("runModsList prints enabled mark and mod rating column", async () => {
  dir = await mkdtemp(join(tmpdir(), "animae-mods-rated-"));
  await runInit({ dir, preset: "@animae/preset-rule" });
  const modDir = join(dir, "mods", "sample-mod");
  await mkdir(modDir, { recursive: true });
  await writeFile(
    join(modDir, "mod.yaml"),
    `id: sample-mod
version: "1.0.0"
name: Sample
rating: teen
`,
  );
  await writeFile(join(dir, "animae.yaml"), `preset: "@animae/preset-rule"
mods:
  - sample-mod
`);
  const { code, out } = await withCapturedStdout(() => runModsList(dir));
  expect(code).toBe(0);
  expect(out).toContain("* sample-mod");
  expect(out).toContain("[rating:teen]");
});

test("runModsExplain prints loaded path line", async () => {
  dir = await mkdtemp(join(tmpdir(), "animae-mods-explain-ok-"));
  await runInit({ dir, preset: "@animae/preset-rule" });
  const { code, out } = await withCapturedStdout(() => runModsExplain(dir, "world/world.yaml"));
  expect(code).toBe(0);
  expect(out).toContain("world/world.yaml");
});

test("validateWithMods ok on init skeleton and rule mode", async () => {
  dir = await mkdtemp(join(tmpdir(), "animae-vwm-"));
  await runInit({ dir, preset: "@animae/preset-rule" });
  const ok = await validateWithMods(dir, undefined, "en", "rule");
  expect(ok.ok).toBe(true);
});

test("validateWithMods returns issues when authored content is invalid", async () => {
  dir = await mkdtemp(join(tmpdir(), "animae-vwm-bad-"));
  await runInit({ dir });
  await writeFile(join(dir, "characters", "player", "card.md"), "broken card\n");
  const result = await validateWithMods(dir);
  expect(result.ok).toBe(false);
  expect(result.issues.length).toBeGreaterThan(0);
});

test("validateWithMods reports unknown mod as MOD failure", async () => {
  dir = await mkdtemp(join(tmpdir(), "animae-vwm-mod-"));
  await runInit({ dir, preset: "@animae/preset-rule" });
  const result = await validateWithMods(dir, ["missing-mod-id"]);
  expect(result.ok).toBe(false);
});

test("validateWithMods maps AnimaeError MOD_CONFIG without detail issues", async () => {
  dir = await mkdtemp(join(tmpdir(), "animae-vwm-modcfg-"));
  await runInit({ dir, preset: "@animae/preset-rule" });
  await writeFile(join(dir, "animae.yaml"), `preset: "@animae/preset-rule"
mods:
  - broken-mod
`);
  const modDir = join(dir, "mods", "broken-mod");
  await mkdir(modDir, { recursive: true });
  await writeFile(join(modDir, "mod.yaml"), "id: broken-mod\nversion: not-semver\nname: Broken\n");
  const result = await validateWithMods(dir);
  expect(result.ok).toBe(false);
  expect(result.issues[0]?.message.length).toBeGreaterThan(0);
});

test("validateWithMods emits name_ref warnings to stderr", async () => {
  dir = await mkdtemp(join(tmpdir(), "animae-vwm-nameref-"));
  await runInit({ dir, preset: "@animae/preset-rule" });
  await writeFile(
    join(dir, "characters", "player", "card.md"),
    `---
identity:
  id: player
  name: Player
tags: []
constraints:
  motives: []
  bottom_lines: []
  taboos: []
lod: principal
---
Hello {{name:unknown-npc}}.
`,
  );
  const { err } = await withCapturedStdout(async () => {
    const r = await validateWithMods(dir);
    expect(r.ok).toBe(true);
    return 0;
  });
  expect(err).toMatch(/warn:/);
});
