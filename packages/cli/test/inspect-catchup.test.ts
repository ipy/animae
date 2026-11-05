import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test, expect } from "bun:test";
import { createEngine, createScriptedModel } from "@animae/engine";
import { runInspect } from "../src/commands/inspect.ts";

let dir = "";

afterEach(async () => {
  if (dir) {
    await rm(dir, { recursive: true, force: true });
    dir = "";
  }
});

async function seedCatchUpRoot(root: string): Promise<void> {
  await mkdir(join(root, "world/locations"), { recursive: true });
  await mkdir(join(root, "characters/player"), { recursive: true });
  await mkdir(join(root, "characters/guide"), { recursive: true });
  await writeFile(
    join(root, "animae.yaml"),
    `seed: 1
policies: []
`,
  );
  await writeFile(
    join(root, "world/world.yaml"),
    `language: en
start_location: home
start:
  day: 1
  minute: 480
`,
  );
  await writeFile(join(root, "world/locations/home.yaml"), "id: home\nname: Home\n");
  for (const id of ["player", "guide"] as const) {
    await writeFile(
      join(root, `characters/${id}/card.md`),
      `---
identity:
  name: ${id}
  summary: ""
  style_examples: []
constraints:
  motives: []
  bottom_lines: []
  taboos: []
lod: principal
tags: []
---
`,
    );
    await writeFile(join(root, `characters/${id}/traits.yaml`), "event_mult: {}\n");
    await writeFile(join(root, `characters/${id}/tracks.yaml`), "{}\n");
    await writeFile(join(root, `characters/${id}/goals.yaml`), "[]\n");
    await writeFile(join(root, `characters/${id}/secrets.yaml`), "[]\n");
    await writeFile(join(root, `characters/${id}/relations.yaml`), "[]\n");
  }
}

test("player queryAsync on unattended character writes offscreen.simulated (inspect uses same path)", async () => {
  dir = await mkdtemp(join(tmpdir(), "animae-inspect-catch-"));
  await seedCatchUpRoot(dir);
  const model = createScriptedModel("scripted", () => ({}));
  const engine = await createEngine({ root: dir, presets: [], models: { s1: model, s2: model }, mode: "rule" });
  try {
    await engine.world.advance({ to: { day: 1, minute: 600 } });
    const before = countOffscreen(engine);
    await engine.queryAsync!("player", "characters/guide/tracks");
    expect(countOffscreen(engine)).toBeGreaterThan(before);
  } finally {
    await engine.close();
  }
});

test("runInspect completes for player character path after time advance", async () => {
  dir = await mkdtemp(join(tmpdir(), "animae-inspect-out-"));
  await seedCatchUpRoot(dir);
  const model = createScriptedModel("scripted", () => ({}));
  const engine = await createEngine({ root: dir, presets: [], models: { s1: model, s2: model }, mode: "rule" });
  try {
    await engine.world.advance({ to: { day: 1, minute: 630 } });
  } finally {
    await engine.close();
  }
  const captured = await captureStdout(() =>
    runInspect({ root: dir, path: "characters/guide/tracks", viewer: "player", mode: "rule" }),
  );
  expect(captured.code).toBe(0);
});

function countOffscreen(engine: { query: (v: string, p: string) => unknown }): number {
  const rows = (engine.query("debug", "events") as { kind: string }[] | undefined) ?? [];
  return rows.filter((e) => e.kind === "offscreen.simulated").length;
}

async function captureStdout(run: () => Promise<number>): Promise<{ code: number; out: string }> {
  const parts: string[] = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((s: string | Uint8Array) => (parts.push(String(s)), true)) as typeof process.stdout.write;
  try {
    const code = await run();
    return { code, out: parts.join("") };
  } finally {
    process.stdout.write = orig;
  }
}
