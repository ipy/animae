import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEngine } from "../../src/engine/create-engine.ts";
import { FsStorage } from "../../src/store/fs.ts";
import { createScriptedModel } from "../../src/model/scripted.ts";
import type { PresetBundle } from "../../src/preset.ts";
import { e2ePreset, seedE2eAuthored } from "../e2e/fixture.ts";

function reflectingPreset(): PresetBundle {
  const base = e2ePreset.policies[0]!.doc as Record<string, unknown>;
  return {
    ...e2ePreset,
    policies: [{ name: "reflect.yaml", doc: { ...base, reflection: { enabled: true, accept: "!conflict" } } }],
  };
}

function models(reflect: () => unknown) {
  const handler = (req: { label?: string }) => {
    if (req.label === "appraise") {
      return { type: "chat", intensity: 0.5, sincerity: 0.9, claims: [], search_terms: [], tags: [], input_class: "normal" };
    }
    if (req.label === "reflect") return reflect();
    return { text: "npc line", cues: [], intent_realized: "talk" };
  };
  return { s1: createScriptedModel("refl/s1", handler), s2: createScriptedModel("refl/s2", handler) };
}

async function endSceneWith(reflect: () => unknown, expectedFailures = 0) {
  const root = await mkdtemp(join(tmpdir(), "animae-reflect-"));
  try {
    const storage = FsStorage(root);
    await seedE2eAuthored(storage);
    const engine = await createEngine({
      root,
      ports: { storage },
      presets: [reflectingPreset()],
      models: models(reflect),
      seed: 1,
      sessionId: "reflect",
    });
    try {
      const sceneId = await engine.scene.start({ location: "tavern", participants: ["player", "npc1"] });
      for await (const _ of engine.scene.turn({ sceneId, actor: "player", text: "hi", addressee: "npc1" })) {
        /* drain */
      }
      const report = await engine.scene.end(sceneId);
      // `warn` appends without being awaited by the code that raised it, so give the last append a moment to land.
      let warnings: { code?: string; owner?: string }[] = [];
      for (let i = 0; i < 50; i++) {
        warnings = (await engine.timeline.events({ kinds: ["config.warning"] })) as unknown as { code?: string; owner?: string }[];
        if (warnings.filter((w) => w.code === "REFLECTION_FAILED").length >= expectedFailures) break;
        await new Promise((r) => setTimeout(r, 20));
      }
      const accepted = await engine.timeline.events({ kinds: ["reflection.accepted"] });
      return { report, warnings, accepted, active: engine.scene.active() };
    } finally {
      await engine.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const BOTH = [
  { owner: "player", accepted: false },
  { owner: "npc1", accepted: false },
];

describe("ending a scene when the reflection is unusable", () => {
  test("a reflection that breaks the schema is skipped with a warning and the scene still ends", async () => {
    const { report, warnings, active } = await endSceneWith(() => ({
      summaries: ["ok"],
      goal_changes: [{ action: "teleport", text: 1 }],
      new_claims: [],
    }), 2);
    expect(active).toBeNull();
    expect(report.reflections).toEqual(BOTH);
    expect(warnings.filter((w) => w.code === "REFLECTION_FAILED").map((w) => w.owner).sort()).toEqual(["npc1", "player"]);
  });

  test("a provider failure while reflecting is skipped the same way", async () => {
    const { report, warnings, active } = await endSceneWith(() => {
      throw new Error("upstream 503");
    }, 2);
    expect(active).toBeNull();
    expect(report.reflections).toEqual(BOTH);
    expect(warnings.some((w) => w.code === "REFLECTION_FAILED")).toBe(true);
  });

  test("an answer with nothing usable records nothing, not a placeholder summary", async () => {
    const { report, warnings, accepted } = await endSceneWith(() => ({ summaries: "nope", goal_changes: 5, new_claims: null }));
    expect(report.reflections).toEqual(BOTH);
    expect(accepted).toEqual([]);
    expect(warnings.some((w) => w.code === "REFLECTION_FAILED")).toBe(false);
  });

  test("a good reflection with extra model-invented keys is accepted", async () => {
    const { report, warnings } = await endSceneWith(() => ({
      summaries: ["They talked a while."],
      goal_changes: [],
      new_claims: [{ s: "player", p: "visited", o: "tavern", confidence: 0.7 }],
      mood: "calm",
    }));
    expect(report.reflections).toEqual([
      { owner: "player", accepted: true },
      { owner: "npc1", accepted: true },
    ]);
    expect(warnings.some((w) => w.code === "REFLECTION_FAILED")).toBe(false);
  });
});
