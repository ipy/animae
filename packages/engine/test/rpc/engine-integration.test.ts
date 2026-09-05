import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "bun:test";
import { createEngine, createRpcServer, createScriptedModel } from "../../src/index.ts";
import { memoryDuplex } from "./duplex.ts";

async function seedRoot(dir: string): Promise<void> {
  await mkdir(join(dir, "world/locations"), { recursive: true });
  await mkdir(join(dir, "characters/player"), { recursive: true });
  await writeFile(
    join(dir, "animae.yaml"),
    `seed: 1
policies: []
models:
  s1: { provider: anthropic, model: claude-haiku-4-5 }
  s2: { provider: anthropic, model: claude-haiku-4-5 }
`,
  );
  await writeFile(join(dir, "world/world.yaml"), "language: en\nstart_location: home\n");
  await writeFile(join(dir, "world/locations/home.yaml"), "id: home\nname: Home\n");
  await writeFile(
    join(dir, "characters/player/card.md"),
    `---
identity:
  name: Player
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
  await writeFile(join(dir, "characters/player/traits.yaml"), "event_mult: {}\n");
  await writeFile(join(dir, "characters/player/tracks.yaml"), "{}\n");
  await writeFile(join(dir, "characters/player/goals.yaml"), "[]\n");
  await writeFile(join(dir, "characters/player/secrets.yaml"), "[]\n");
  await writeFile(join(dir, "characters/player/relations.yaml"), "[]\n");
}

test("RPC info against real engine", async () => {
  const dir = await mkdtemp(join(tmpdir(), "animae-rpc-e2e-"));
  try {
    await seedRoot(dir);
    const model = createScriptedModel("scripted", () => ({}));
    const engine = await createEngine({
      root: dir,
      presets: [],
      models: { s1: model, s2: model },
    });
    const io = memoryDuplex();
    const server = createRpcServer(engine, io);
    const run = server.run();
    io.push(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "info" }));
    io.close();
    await run;
    const msg = JSON.parse(io.written[0]!);
    expect(msg.result.branch).toBe("main");
    await engine.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
