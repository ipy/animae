import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEngine } from "../../src/engine/create-engine.ts";
import { FsStorage } from "../../src/store/fs.ts";
import { createScriptedModel } from "../../src/model/scripted.ts";
import { e2ePreset, seedE2eAuthored } from "../e2e/fixture.ts";

const models = {
  s1: createScriptedModel("gate/s1", () => ({ text: "hi", cues: [], intent_realized: "talk" })),
  s2: createScriptedModel("gate/s2", () => ({ type: "chat", intensity: 0.5, sincerity: 0.9, claims: [], search_terms: [], tags: [], input_class: "normal" })),
};

test("parallel scene.turn calls serialize", async () => {
  const root = await mkdtemp(join(tmpdir(), "animae-gate-"));
  try {
    await seedE2eAuthored(FsStorage(root));
    const engine = await createEngine({ root, presets: [e2ePreset], models, sessionId: "gate_sess" });
    const sceneId = await engine.scene.start({ location: "tavern", participants: ["player", "npc1"] });
    const t1 = engine.scene.turn({ sceneId, actor: "player", text: "one", addressee: "npc1" });
    const t2 = engine.scene.turn({ sceneId, actor: "player", text: "two", addressee: "npc1" });
    const run = async (it: AsyncIterable<{ type: string }>) => {
      for await (const _ of it) {
        /* drain */
      }
    };
    await Promise.all([run(t1), run(t2)]);
    await engine.scene.end(sceneId);
    await engine.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("close awaits in-flight turn append queue", async () => {
  const root = await mkdtemp(join(tmpdir(), "animae-gate-close-"));
  try {
    await seedE2eAuthored(FsStorage(root));
    const engine = await createEngine({ root, presets: [e2ePreset], models, sessionId: "gate_close" });
    const sceneId = await engine.scene.start({ location: "tavern", participants: ["player", "npc1"] });
    const iter = engine.scene.turn({ sceneId, actor: "player", text: "stream", addressee: "npc1" });
    const closeP = engine.close();
    for await (const _ of iter) {
      /* consume while closing */
    }
    await closeP;
    const reopen = await createEngine({ root, presets: [e2ePreset], models, sessionId: "gate_reopen" });
    const ev = await reopen.timeline.events({ kinds: ["input.received"] });
    expect(ev.length).toBeGreaterThan(0);
    await reopen.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("double close is safe and lock can reopen", async () => {
  const root = await mkdtemp(join(tmpdir(), "animae-gate-double-close-"));
  try {
    await seedE2eAuthored(FsStorage(root));
    const engine = await createEngine({ root, presets: [e2ePreset], models, sessionId: "gate_double" });
    await engine.close();
    await engine.close();
    const again = await createEngine({ root, presets: [e2ePreset], models, sessionId: "gate_double2" });
    await again.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
