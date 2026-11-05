import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { runInit } from "../src/commands/init.ts";
import { runTimeline } from "../src/commands/timeline.ts";
import { openEngine } from "../src/engine-open.ts";
import { withCapturedStdout } from "./helpers/io.ts";

let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "animae-timeline-cmd-"));
  await runInit({ dir, preset: "@animae/preset-rule" });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const opts = () => ({ root: dir, mode: "rule" as const });

test("timeline list prints branch and saves", async () => {
  const { code, out } = await withCapturedStdout(() => runTimeline("list", [], opts()));
  expect(code).toBe(0);
  expect(out).toContain("branch:");
});

test("timeline save and load round-trip", async () => {
  const save = await withCapturedStdout(() => runTimeline("save", ["checkpoint"], opts()));
  expect(save.code).toBe(0);
  expect(save.out).toContain("checkpoint");

  const load = await withCapturedStdout(() => runTimeline("load", ["checkpoint"], opts()));
  expect(load.code).toBe(0);
  expect(load.out).toContain("Loaded checkpoint");
});

test("timeline usage errors for missing args", async () => {
  expect(await withCapturedStdout(() => runTimeline("load", [], opts())).then((r) => r.code)).toBe(1);
  expect(await withCapturedStdout(() => runTimeline("rewind", [], opts())).then((r) => r.code)).toBe(1);
  expect(await withCapturedStdout(() => runTimeline("switch", [], opts())).then((r) => r.code)).toBe(1);
  expect(await withCapturedStdout(() => runTimeline("diff", ["main"], opts())).then((r) => r.code)).toBe(1);
});

test("timeline diff, switch, prune, export, import", async () => {
  const diff = await withCapturedStdout(() => runTimeline("diff", ["main", "main"], opts()));
  expect(diff.code).toBe(0);
  expect(diff.out).toContain('"state"');

  const sw = await withCapturedStdout(() => runTimeline("switch", ["main"], opts()));
  expect(sw.code).toBe(0);

  const ex = await withCapturedStdout(() => runTimeline("export", ["main", "--file", "branch-export.json"], opts()));
  expect(ex.code).toBe(0);
  expect(ex.out).toContain("branch-export.json");

  const imp = await withCapturedStdout(() => runTimeline("import", ["branch-export.json"], opts()));
  expect(imp.code).toBe(0);
  expect(imp.out).toContain("Imported branch");

  const pr = await withCapturedStdout(() => runTimeline("prune", ["main"], opts()));
  expect(pr.code).toBe(0);
});

test("timeline unknown subcommand", async () => {
  const { code, err } = await withCapturedStdout(() => runTimeline("nope", [], opts()));
  expect(code).toBe(1);
  expect(err).toContain("Unknown timeline subcommand");
});

test("timeline replay after a rule turn", async () => {
  const engine = await openEngine({ root: dir, mode: "rule" });
  try {
    const sceneId = await engine.scene.start({ location: "home", participants: ["player"] });
    for await (const _ of engine.scene.turn({ sceneId, actor: "player", text: "hello" })) {
      /* drain */
    }
  } finally {
    await engine.close();
  }
  const { code, out } = await withCapturedStdout(() => runTimeline("replay", ["main"], opts()));
  expect(code).toBe(0);
  expect(out.length).toBeGreaterThan(0);
});

test("timeline openEngine failure prints error", async () => {
  const missing = await mkdtemp(join(tmpdir(), "animae-timeline-del-"));
  await rm(missing, { recursive: true, force: true });
  const { code, err } = await withCapturedStdout(() => runTimeline("list", [], { root: missing, mode: "rule" }));
  expect(code).toBe(1);
  expect(err.length).toBeGreaterThan(0);
});
