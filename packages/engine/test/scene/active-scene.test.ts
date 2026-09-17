import { test, expect, describe } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEngine } from "../../src/engine/create-engine.ts";
import { FsStorage } from "../../src/store/fs.ts";
import { createScriptedModel } from "../../src/model/scripted.ts";
import { e2ePreset, seedE2eAuthored } from "../e2e/fixture.ts";

function scriptedModels() {
  const handler = (req: { label?: string }) => {
    if (req.label === "appraise") {
      return { type: "chat", intensity: 0.5, sincerity: 0.9, claims: [], search_terms: [], tags: [], input_class: "normal" };
    }
    if (req.label === "reflect") return { summaries: [], goal_changes: [], new_claims: [] };
    return { text: "npc line", cues: [], intent_realized: "talk" };
  };
  return { s1: createScriptedModel("active/s1", handler), s2: createScriptedModel("active/s2", handler) };
}

async function withEngine(run: (engine: Awaited<ReturnType<typeof createEngine>>) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "animae-active-scene-"));
  try {
    const storage = FsStorage(root);
    await seedE2eAuthored(storage);
    const engine = await createEngine({
      root,
      ports: { storage },
      presets: [e2ePreset],
      models: scriptedModels(),
      seed: 1,
      sessionId: "active_scene_test",
    });
    try {
      await run(engine);
    } finally {
      await engine.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("Engine.scene.active", () => {
  test("tracks start and end", async () => {
    await withEngine(async (engine) => {
      expect(engine.scene.active()).toBeNull();
      const id = await engine.scene.start({ location: "tavern", participants: ["player", "npc1"] });
      expect(engine.scene.active()).toEqual({
        id,
        location: "tavern",
        participants: ["player", "npc1"],
        turn: 0,
      });
      await engine.scene.end(id);
      expect(engine.scene.active()).toBeNull();
    });
  });

  test("returns a copy, so callers cannot mutate the live participant list", async () => {
    await withEngine(async (engine) => {
      await engine.scene.start({ location: "tavern", participants: ["player", "npc1"] });
      engine.scene.active()!.participants.push("intruder");
      expect(engine.scene.active()!.participants).toEqual(["player", "npc1"]);
    });
  });

  test("follows timeline loads: a load can drop or restore the open scene", async () => {
    await withEngine(async (engine) => {
      await engine.timeline.save("before");
      const id = await engine.scene.start({ location: "tavern", participants: ["player", "npc1"] });
      await engine.timeline.save("during");
      expect(engine.scene.active()?.id).toBe(id);

      await engine.timeline.load("before");
      expect(engine.scene.active()).toBeNull();
      // The stale id the host used to cache is rejected by `end` and `turn`.
      await expect(engine.scene.end(id)).rejects.toMatchObject({ code: "SCENE_INVALID" });

      await engine.timeline.load("during");
      expect(engine.scene.active()?.id).toBe(id);
    });
  });
});
