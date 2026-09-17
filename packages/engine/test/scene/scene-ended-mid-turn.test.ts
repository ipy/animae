import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEngine } from "../../src/engine/create-engine.ts";
import { FsStorage } from "../../src/store/fs.ts";
import { createScriptedModel } from "../../src/model/scripted.ts";
import type { PresetBundle } from "../../src/preset.ts";
import type { TurnChunk } from "../../src/types.ts";
import { e2ePreset, seedE2eAuthored } from "../e2e/fixture.ts";

function scriptedModels() {
  const handler = (req: { label?: string }) => {
    if (req.label === "appraise") {
      return { type: "care", intensity: 0.5, sincerity: 0.9, claims: [], search_terms: [], tags: [], input_class: "normal" };
    }
    if (req.label === "reflect") return { summaries: [], goal_changes: [], new_claims: [] };
    return { text: "npc line", cues: [], intent_realized: "talk" };
  };
  return {
    s1: createScriptedModel("ended/s1", handler),
    s2: createScriptedModel("ended/s2", handler),
  };
}

/**
 * A preset whose only custom rule ends the scene the moment a `care` event is adjudicated in the tavern (the `when`
 * also proves adjudicate-stage CEL can read `scene.*`).
 */
function presetEndingOnCare(autonomous: number): PresetBundle {
  const base = e2ePreset.policies[0]!.doc as Record<string, unknown> & {
    scene?: Record<string, unknown>;
    rules?: Record<string, unknown>;
  };
  return {
    ...e2ePreset,
    policies: [
      {
        name: "ending.yaml",
        doc: {
          ...base,
          rules: { ...(base.rules ?? {}), custom: [{ id: "stop", fn: "stop_scene", when: "scene.location == 'tavern' && event.type == 'care'", stage: "adjudicate" }] },
          scene: { ...(base.scene ?? {}), autonomous: { maxExchangesPerPlayerTurn: autonomous, when: "true" } },
        },
      },
    ],
    rules: (reg) => {
      reg.register("stop_scene", (ctx) => [
        { kind: "scene.ended", sceneId: (ctx.vars.scene as { id: string }).id, turns: 0 } as never,
      ]);
    },
  };
}

async function withEngine(
  preset: PresetBundle,
  run: (engine: Awaited<ReturnType<typeof createEngine>>) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "animae-ended-"));
  try {
    const storage = FsStorage(root);
    await seedE2eAuthored(storage);
    const engine = await createEngine({ root, ports: { storage }, presets: [preset], models: scriptedModels(), seed: 1, sessionId: "ended" });
    try {
      await run(engine);
    } finally {
      await engine.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function collect(iter: AsyncIterable<TurnChunk>): Promise<TurnChunk[]> {
  const out: TurnChunk[] = [];
  for await (const c of iter) out.push(c);
  return out;
}

describe("a rule that ends the scene during a turn", () => {
  for (const autonomous of [0, 2]) {
    test(`the turn still replies, the scene is closed and no extra exchange follows (autonomous=${autonomous})`, async () => {
      await withEngine(presetEndingOnCare(autonomous), async (engine) => {
        const sceneId = await engine.scene.start({ location: "tavern", participants: ["player", "npc1", "npc2"] });
        const chunks = await collect(engine.scene.turn({ sceneId, actor: "player", text: "take care", addressee: "npc1" }));

        expect(chunks.some((c) => c.type === "text" && c.text === "npc line")).toBe(true);
        expect(chunks.filter((c) => c.type === "done")).toHaveLength(1);
        expect(engine.scene.active()).toBeNull();

        const received = await engine.timeline.events({ kinds: ["input.received"] });
        expect(received).toHaveLength(1);

        // The world stays playable: a new scene opens and takes turns again.
        const next = await engine.scene.start({ location: "tavern", participants: ["player", "npc1"] });
        expect(next).not.toBe(sceneId);
        const again = await collect(engine.scene.turn({ sceneId: next, actor: "player", text: "again", addressee: "npc1" }));
        expect(again.some((c) => c.type === "done")).toBe(true);
      });
    });
  }

  test("a turn against the ended scene is refused instead of crashing", async () => {
    await withEngine(presetEndingOnCare(0), async (engine) => {
      const sceneId = await engine.scene.start({ location: "tavern", participants: ["player", "npc1"] });
      await collect(engine.scene.turn({ sceneId, actor: "player", text: "take care", addressee: "npc1" }));
      let code = "";
      try {
        await collect(engine.scene.turn({ sceneId, actor: "player", text: "hello?", addressee: "npc1" }));
      } catch (err) {
        code = (err as { code?: string }).code ?? "";
      }
      expect(code).toBe("SCENE_INVALID");
    });
  });
});
