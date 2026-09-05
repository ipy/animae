import { test, expect, describe } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEngine } from "../../src/engine/create-engine.ts";
import { FsStorage } from "../../src/store/fs.ts";
import { createScriptedModel } from "../../src/model/scripted.ts";
import type { PresetBundle } from "../../src/preset.ts";
import { e2ePreset, seedE2eAuthored } from "../e2e/fixture.ts";

function scriptedModels() {
  const handler = (req: { label?: string }) => {
    if (req.label === "appraise") {
      return {
        type: "chat",
        intensity: 0.5,
        sincerity: 0.9,
        claims: [],
        search_terms: [],
        tags: [],
        input_class: "normal",
      };
    }
    if (req.label === "reflect") {
      return { summaries: [], goal_changes: [], new_claims: [] };
    }
    return { text: "npc line", cues: [], intent_realized: "talk" };
  };
  return {
    s1: createScriptedModel("scene/s1", handler),
    s2: createScriptedModel("scene/s2", handler),
  };
}

function presetWithScene(scene: Record<string, unknown>): PresetBundle {
  const base = e2ePreset.policies[0]!.doc as Record<string, unknown> & { scene?: Record<string, unknown> };
  return {
    ...e2ePreset,
    policies: [
      {
        name: "scene-test.yaml",
        doc: { ...base, scene: { ...(base.scene ?? {}), ...scene } },
      },
    ],
  };
}

async function withSceneEngine(
  preset: PresetBundle,
  run: (engine: Awaited<ReturnType<typeof createEngine>>) => Promise<void>,
) {
  const root = await mkdtemp(join(tmpdir(), "animae-scene-"));
  try {
    const storage = FsStorage(root);
    await seedE2eAuthored(storage);
    const engine = await createEngine({
      root,
      ports: { storage },
      presets: [preset],
      models: scriptedModels(),
      seed: 1,
      sessionId: "scene_test",
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

async function lastUtteranceSpeaker(engine: Awaited<ReturnType<typeof createEngine>>): Promise<string | undefined> {
  const ev = await engine.timeline.events({ kinds: ["utterance"] });
  const last = ev.at(-1) as { speaker?: string } | undefined;
  return last?.speaker;
}

async function collectDoneCount(iter: AsyncIterable<{ type: string }>): Promise<number> {
  let n = 0;
  for await (const c of iter) {
    if (c.type === "done") n += 1;
  }
  return n;
}

describe("scene turn-taking (§14)", () => {
  test("addressed: addressee speaks", async () => {
    await withSceneEngine(presetWithScene({ turnTaking: "addressed" }), async (engine) => {
      const sceneId = await engine.scene.start({
        location: "tavern",
        participants: ["player", "npc1", "npc2"],
      });
      await collectDoneCount(engine.scene.turn({ sceneId, actor: "player", text: "hi", addressee: "npc2" }));
      expect(await lastUtteranceSpeaker(engine)).toBe("npc2");
    });
  });

  test("round_robin: rotates NPC speaker across player turns", async () => {
    await withSceneEngine(presetWithScene({ turnTaking: "round_robin" }), async (engine) => {
      const sceneId = await engine.scene.start({
        location: "tavern",
        participants: ["player", "npc1", "npc2"],
      });
      await collectDoneCount(engine.scene.turn({ sceneId, actor: "player", text: "one" }));
      expect(await lastUtteranceSpeaker(engine)).toBe("npc1");
      await collectDoneCount(engine.scene.turn({ sceneId, actor: "player", text: "two" }));
      expect(await lastUtteranceSpeaker(engine)).toBe("npc2");
    });
  });

  test("priority CEL: highest-scoring NPC speaks", async () => {
    await withSceneEngine(
      presetWithScene({ turnTaking: { priority: "self.id == 'npc2'" } }),
      async (engine) => {
        const sceneId = await engine.scene.start({
          location: "tavern",
          participants: ["player", "npc1", "npc2"],
        });
        await collectDoneCount(engine.scene.turn({ sceneId, actor: "player", text: "hey" }));
        expect(await lastUtteranceSpeaker(engine)).toBe("npc2");
      },
    );
  });

  test("autonomous exchanges run extra turns toward budget", async () => {
    await withSceneEngine(
      presetWithScene({
        turnTaking: "addressed",
        autonomous: { maxExchangesPerPlayerTurn: 1, when: "true" },
      }),
      async (engine) => {
        const sceneId = await engine.scene.start({
          location: "tavern",
          participants: ["player", "npc1", "npc2"],
        });
        const done = await collectDoneCount(
          engine.scene.turn({ sceneId, actor: "player", text: "hello", addressee: "npc1" }),
        );
        expect(done).toBe(2);
        const received = await engine.timeline.events({ kinds: ["input.received"] });
        expect(received.length).toBeGreaterThanOrEqual(2);
      },
    );
  });
});
