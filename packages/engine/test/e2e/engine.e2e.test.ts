import { test, expect, describe } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEngine } from "../../src/engine/create-engine.ts";
import { FsStorage } from "../../src/store/fs.ts";
import { createScriptedModel } from "../../src/model/scripted.ts";
import { e2ePreset, seedE2eAuthored } from "./fixture.ts";
import { stableStringify } from "../../src/store/util.ts";

function scriptedModels() {
  let renderN = 0;
  const body = (req: { label?: string; schema: { parse: (v: unknown) => unknown } }) => {
    if (req.label === "appraise") {
      return {
        type: "chat",
        intensity: 0.55,
        sincerity: 0.9,
        claims: [{ s: "npc1", p: "likes", o: "tavern" }],
        search_terms: ["tavern"],
        tags: ["social"],
        input_class: "normal",
      };
    }
    if (req.label === "reflect") {
      return { summaries: [], goal_changes: [], new_claims: [] };
    }
    return {
      text: `Hello from NPC ${++renderN}.`,
      cues: [{ type: "emotion", args: { mood: "warm" }, at: 0 }],
      intent_realized: "talk",
    };
  };
  const handler = (req: Parameters<Parameters<typeof createScriptedModel>[1]>[0]) => body(req);
  return {
    s1: createScriptedModel("e2e/s1", handler),
    s2: createScriptedModel("e2e/s2", handler),
  };
}

async function withEngine(run: (ctx: { root: string; engine: Awaited<ReturnType<typeof createEngine>> }) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "animae-e2e-"));
  try {
    const storage = FsStorage(root);
    await seedE2eAuthored(storage);
    const engine = await createEngine({
      root,
      ports: { storage },
      presets: [e2ePreset],
      models: scriptedModels(),
      modelMode: "record",
      seed: 42,
      sessionId: "e2e_sess",
    });
    try {
      await run({ root, engine });
    } finally {
      await engine.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function collectTurn(iter: AsyncIterable<{ type: string; text?: string; events?: string[] }>) {
  const chunks: unknown[] = [];
  const events: string[] = [];
  for await (const c of iter) {
    chunks.push(c);
    if (c.type === "done" && c.events) events.push(...c.events);
  }
  return { chunks, events };
}

describe("engine e2e", () => {
  test("createEngine opens timeline and runs a multi-turn scene", async () => {
    await withEngine(async ({ engine }) => {
      const sceneId = await engine.scene.start({
        location: "tavern",
        participants: ["player", "npc1"],
        fields: ["salience"],
      });
      expect(sceneId).toMatch(/^scn_/);

      const t1 = await collectTurn(
        engine.scene.turn({ sceneId, actor: "player", text: "Hi Aria!", addressee: "npc1" }),
      );
      expect(t1.chunks.some((c) => (c as { type: string }).type === "text")).toBe(true);
      expect(t1.chunks.some((c) => (c as { type: string }).type === "done")).toBe(true);

      const ev = await engine.timeline.events({ kinds: ["utterance", "track.delta", "input.received"] });
      expect(ev.some((e) => e.kind === "input.received")).toBe(true);
      expect(ev.some((e) => e.kind === "utterance")).toBe(true);

      const report = await engine.scene.end(sceneId);
      expect(report.turns).toBeGreaterThan(0);
      expect(report.sceneId).toBe(sceneId);
    });
  });

  test("save, load, rewind, and diff", async () => {
    await withEngine(async ({ engine }) => {
      const sceneId = await engine.scene.start({ location: "tavern", participants: ["player", "npc1"] });
      await collectTurn(engine.scene.turn({ sceneId, actor: "player", text: "one", addressee: "npc1" }));
      const slot = await engine.timeline.save("mid");
      await collectTurn(engine.scene.turn({ sceneId, actor: "player", text: "two", addressee: "npc1" }));
      await engine.scene.end(sceneId);

      const before = await engine.timeline.events();
      await engine.timeline.load(slot);
      const after = await engine.timeline.events();
      expect(after.length).toBeLessThan(before.length);

      const lastId = after.at(-1)!.id;
      await engine.timeline.rewind(lastId);
      const branch = engine.timeline.current();
      expect(branch.name).toBeTruthy();
      const branches = await engine.timeline.branches();
      expect(branches.length).toBeGreaterThan(1);
      const diff = await engine.timeline.diff("main", branch.name);
      expect(diff.events.onlyA.length + diff.events.onlyB.length).toBeGreaterThan(0);
    });
  });

  test("replay mode reproduces recorded chunks", async () => {
    const root = await mkdtemp(join(tmpdir(), "animae-replay-"));
    try {
      const storage = FsStorage(root);
      await seedE2eAuthored(storage);
      const models = scriptedModels();
      const live = await createEngine({
        root,
        ports: { storage },
        presets: [e2ePreset],
        models,
        modelMode: "record",
        seed: 42,
        sessionId: "replay_a",
      });
      const sceneId = await live.scene.start({ location: "tavern", participants: ["player", "npc1"] });
      const recorded = await collectTurn(
        live.scene.turn({ sceneId, actor: "player", text: "replay me", addressee: "npc1" }),
      );
      await live.scene.end(sceneId);
      const eventLog = stableStringify(await live.timeline.events());
      await live.close();

      const replay = await createEngine({
        root,
        ports: { storage: FsStorage(root) },
        presets: [e2ePreset],
        models,
        modelMode: "replay",
        seed: 42,
        sessionId: "replay_b",
      });
      const chunks: unknown[] = [];
      for await (const c of replay.timeline.replay("main")) chunks.push(c);
      const replayLog = stableStringify(await replay.timeline.events());
      await replay.close();

      expect(replayLog).toBe(eventLog);
      expect(stableStringify(chunks)).toBe(stableStringify(recorded.chunks));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("hot reload swaps config on valid edit", async () => {
    await withEngine(async ({ root, engine }) => {
      const r0 = await engine.info();
      expect(r0.language).toBe("en");
      const storage = FsStorage(root);
      const world = (await storage.readText("world/world.yaml")) ?? "";
      await storage.writeAtomic("world/world.yaml", world.replace("language: en", "language: de"));
      const r = await engine.reload();
      expect(r.ok).toBe(true);
      expect(engine.info().language).toBe("de");
    });
  });

  test("hot reload keeps old config on invalid edit", async () => {
    await withEngine(async ({ root, engine }) => {
      const storage = FsStorage(root);
      await storage.writeAtomic("world/locations/broken.yaml", "id: broken\n");
      await storage.remove("world/locations/tavern.yaml");
      const r = await engine.reload();
      expect(r.ok).toBe(false);
      expect(engine.info().language).toBe("en");
    });
  });

  test("storage lock released after close allows reopen", async () => {
    const root = await mkdtemp(join(tmpdir(), "animae-lock-"));
    try {
      await seedE2eAuthored(FsStorage(root));
      const e1 = await createEngine({ root, presets: [e2ePreset], models: scriptedModels(), sessionId: "l1" });
      await e1.close();
      const e2 = await createEngine({ root, presets: [e2ePreset], models: scriptedModels(), sessionId: "l2" });
      await e2.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("performance: append 1000 events", async () => {
    await withEngine(async ({ engine }) => {
      const t0 = performance.now();
      for (let i = 0; i < 1000; i++) {
        await engine.world.set(`bench.${i}`, i);
      }
      const ms = performance.now() - t0;
      const ev = await engine.timeline.events();
      expect(ev.length).toBeGreaterThanOrEqual(1000);
      expect(ms).toBeLessThan(30_000);
    });
  });
});
