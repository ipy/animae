import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
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

async function rpcRoundTrip(
  engine: Awaited<ReturnType<typeof createEngine>>,
  method: string,
  params?: unknown,
): Promise<{ result?: unknown; error?: { code: number; message: string; data?: unknown } }> {
  const io = memoryDuplex();
  const server = createRpcServer(engine, io);
  const run = server.run();
  io.push(JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: params ?? {} }));
  io.close();
  await run;
  const lines = io.written.map((l) => JSON.parse(l) as { id?: number; result?: unknown; error?: { code: number; message: string; data?: unknown } });
  const reply = lines.find((l) => l.id === 1);
  if (!reply) throw new Error("missing JSON-RPC reply");
  return reply;
}

describe("RPC handler parity", () => {
  test("setUiLocale, display helpers, mods", async () => {
    const dir = await mkdtemp(join(tmpdir(), "animae-rpc-parity-"));
    try {
      await seedRoot(dir);
      const model = createScriptedModel("scripted", () => ({}));
      const engine = await createEngine({ root: dir, presets: [], models: { s1: model, s2: model } });
      const locale = await rpcRoundTrip(engine, "setUiLocale", { locale: "fr" });
      expect(locale.error).toBeUndefined();

      const mods = await rpcRoundTrip(engine, "mods");
      expect(mods.result).toMatchObject({ mods: expect.any(Array), drift: expect.any(Boolean) });

      const resolved = await rpcRoundTrip(engine, "display.resolve", { value: "plain" });
      expect(resolved.result).toBe("plain");

      const name = await rpcRoundTrip(engine, "display.entityDisplayName", { entityId: "player" });
      expect(typeof name.result).toBe("string");

      await engine.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("scene.turn accepts outputLocale", async () => {
    const dir = await mkdtemp(join(tmpdir(), "animae-rpc-turn-locale-"));
    try {
      await seedRoot(dir);
      const model = createScriptedModel("scripted", (req) => {
        if (req.label === "appraise") {
          return { type: "chat", intensity: 0.2, sincerity: 1, claims: [], search_terms: [], tags: [], input_class: "normal" };
        }
        return { text: "ok", cues: [], intent_realized: "respond" };
      });
      const engine = await createEngine({ root: dir, presets: [], models: { s1: model, s2: model } });
      const sceneId = await engine.scene.start({ location: "home", participants: ["player"] });
      const msg = await rpcRoundTrip(engine, "scene.turn", {
        sceneId,
        actor: "player",
        text: "hi",
        outputLocale: "de",
      });
      expect(msg.error).toBeUndefined();
      expect((msg.result as { chunks?: unknown[] }).chunks?.length).toBeGreaterThan(0);
      await engine.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("entities.setAlias spawn retire param validation", async () => {
    const dir = await mkdtemp(join(tmpdir(), "animae-rpc-entities-"));
    try {
      await seedRoot(dir);
      const model = createScriptedModel("scripted", () => ({}));
      const engine = await createEngine({ root: dir, presets: [], models: { s1: model, s2: model } });
      const bad = await rpcRoundTrip(engine, "entities.retire", { ref: 123 });
      expect(bad.error?.code).toBe(-32602);

      const badAlias = await rpcRoundTrip(engine, "entities.setAlias", { input: "bad" });
      expect(badAlias.error?.code).toBe(-32603);
      await engine.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("query uses queryAsync path on real engine", async () => {
    const dir = await mkdtemp(join(tmpdir(), "animae-rpc-query-"));
    try {
      await seedRoot(dir);
      const model = createScriptedModel("scripted", () => ({}));
      const engine = await createEngine({ root: dir, presets: [], models: { s1: model, s2: model } });
      const msg = await rpcRoundTrip(engine, "query", { viewer: "player", path: "world/location" });
      expect(msg.error).toBeUndefined();
      expect(msg.result).toBeDefined();
      await engine.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("unknown viewer path still returns param errors for malformed query", async () => {
    const dir = await mkdtemp(join(tmpdir(), "animae-rpc-query-bad-"));
    try {
      await seedRoot(dir);
      const model = createScriptedModel("scripted", () => ({}));
      const engine = await createEngine({ root: dir, presets: [], models: { s1: model, s2: model } });
      const msg = await rpcRoundTrip(engine, "query", { viewer: "player", path: 42 });
      expect(msg.error?.code).toBe(-32602);
      await engine.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("blocked registrars", () => {
  test.each([
    "rules.register",
    "hooks.register",
    "introspect.registerViewer",
  ] as const)("method %s returns -32601", async (method) => {
    const io = memoryDuplex();
    const model = createScriptedModel("scripted", () => ({}));
    const dir = await mkdtemp(join(tmpdir(), "animae-rpc-block-"));
    try {
      await seedRoot(dir);
      const engine = await createEngine({ root: dir, presets: [], models: { s1: model, s2: model } });
      const server = createRpcServer(engine, io);
      const run = server.run();
      io.push(JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: {} }));
      io.close();
      await run;
      expect(io.written[0]).toContain('"code":-32601');
      await engine.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
