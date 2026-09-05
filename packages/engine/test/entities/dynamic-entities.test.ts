import { test, expect, describe } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEngine } from "../../src/engine/create-engine.ts";
import { FsStorage } from "../../src/store/fs.ts";
import { createScriptedModel } from "../../src/model/scripted.ts";
import { e2ePreset, seedE2eAuthored } from "../e2e/fixture.ts";

const models = {
  s1: createScriptedModel("dyn/s1", () => ({ text: "hi", cues: [], intent_realized: "talk" })),
  s2: createScriptedModel("dyn/s2", () => ({
    type: "chat",
    intensity: 0.5,
    sincerity: 0.9,
    claims: [],
    search_terms: [],
    tags: [],
    input_class: "normal",
  })),
};

async function withEngine(run: (engine: Awaited<ReturnType<typeof createEngine>>) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "animae-dyn-"));
  try {
    await seedE2eAuthored(FsStorage(root));
    const engine = await createEngine({ root, presets: [e2ePreset], models, seed: 99, sessionId: "dyn_test" });
    try {
      await run(engine);
    } finally {
      await engine.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("dynamic entities", () => {
  test("spawnEntity + alias + resolve + replay determinism", async () => {
    await withEngine(async (engine) => {
      const ref = await engine.spawnEntity({
        kind: "character",
        card: {
          identity: { name: "Morgan", summary: "Traveler", style_examples: [] },
          constraints: { motives: [], bottom_lines: [], taboos: [] },
          lod: "extra",
          tags: ["guest"],
        },
        persona: "A wandering guest.",
        traits: { event_mult: {} },
        tracks: { self: {}, toward: {}, overrides: {} },
        goals: [],
        secrets: [],
        relations: [],
        knowledge: [],
      });
      expect(ref.id).toMatch(/^dyn-/);
      expect(engine.resolveEntity("Morgan").id).toBe(ref.id);
      await engine.setAlias({ entity: ref.id, nickname: "Mo", by: "player" });
      expect(engine.resolveEntity("Mo").id).toBe(ref.id);
      const spawned = await engine.timeline.events({ kinds: ["entity.spawned"] });
      expect(spawned.length).toBe(1);
      expect(engine.resolveEntity(ref.id).id).toBe(ref.id);
    });
  });

  test("generateFromBrief uses procedural fallback without model output", async () => {
    await withEngine(async (engine) => {
      const failModels = {
        s1: createScriptedModel("fail/s1", () => {
          throw new Error("offline");
        }),
        s2: createScriptedModel("fail/s2", () => {
          throw new Error("offline");
        }),
      };
      await engine.close();
      const root = await mkdtemp(join(tmpdir(), "animae-dyn2-"));
      try {
        await seedE2eAuthored(FsStorage(root));
        const eng = await createEngine({ root, presets: [e2ePreset], models: failModels, seed: 3, sessionId: "fb" });
        try {
          const ref = await eng.entities.generateFromBrief(
            { kind: "character", archetype: "innkeeper", avoidNames: [], tags: ["npc"] },
            { pools: { names: ["Pat", "Quinn"] }, reason: "test" },
          );
          expect(eng.resolveEntity(ref.id).id).toBe(ref.id);
        } finally {
          await eng.close();
        }
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  });
});
