import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createEngine } from "../../src/engine/create-engine.ts";
import {
  collectTurn,
  lifecyclePreset,
  openSessionEngine,
  playTurn,
  streamingLifecycleLlm,
} from "./session-fixture.ts";

describe("session lifecycle (LLM)", () => {
  test("three-character scene: streams, tracks, memory, reflection, timeline ops", async () => {
    const llm = streamingLifecycleLlm();
    const h = await openSessionEngine({
      preset: lifecyclePreset(),
      models: { s1: llm.s1, s2: llm.s2 },
      mode: "full",
      modelMode: "record",
      sessionId: "sess_life",
    });
    try {
      const { engine, root } = h;
      const scene1 = await engine.scene.start({
        location: "tavern",
        participants: ["player", "npc1", "npc2"],
        fields: ["salience"],
      });
      expect(scene1).toMatch(/^scn_/);

      const t1 = await collectTurn(engine.scene.turn({ sceneId: scene1, actor: "player", text: "Hi Aria!", addressee: "npc1" }));
      const textTypes = t1.chunks.map((c) => c.type);
      expect(textTypes.indexOf("text")).toBeLessThan(textTypes.indexOf("done"));
      const npcTexts = t1.chunks.filter((c): c is Extract<(typeof t1.chunks)[0], { type: "text" }> => c.type === "text" && c.speaker === "npc1");
      expect(npcTexts.length).toBeGreaterThanOrEqual(2);
      expect(npcTexts.map((c) => c.text).join("")).toBe("PartA-1 PartB PartC.");
      expect(t1.chunks.some((c) => c.type === "cue" && c.cue.type === "emotion")).toBe(true);
      const utterance = (await engine.timeline.events({ kinds: ["utterance"] }))[0] as { text?: string; cues?: unknown[] };
      expect(utterance?.text).toBe("PartA-1 PartB PartC.");
      expect((utterance?.cues ?? []).length).toBeGreaterThan(0);

      await playTurn(engine, scene1, "thank you for the warm welcome");
      await playTurn(engine, scene1, "do you remember the tavern?");
      await playTurn(engine, scene1, "tell me about the heirloom ring", { addressee: "npc1" });

      const tierEvents = await engine.timeline.events({ kinds: ["track.delta", "track.tier_changed"] });
      expect(tierEvents.some((e) => e.kind === "track.delta")).toBe(true);

      const checks = await engine.timeline.events({ kinds: ["check.rolled"] });
      if (checks.length > 0) {
        expect(checks[0]).toMatchObject({ kind: "check.rolled" });
      }

      const end1 = await engine.scene.end(scene1);
      expect(end1.turns).toBeGreaterThanOrEqual(4);
      expect(end1.sceneId).toBe(scene1);

      const reflections = await engine.timeline.events({ kinds: ["reflection.accepted", "reflection.proposed"] });
      expect(reflections.some((e) => e.kind === "reflection.proposed")).toBe(true);

      const memArtifact = await readFile(join(root, "timelines", "main", "artifacts", "npc1", "memory.jsonl"), "utf8");
      expect(memArtifact.split("\n").filter(Boolean).length).toBeGreaterThan(0);

      const scene2 = await engine.scene.start({ location: "tavern", participants: ["player", "npc1"] });
      await playTurn(engine, scene2, "do you still remember our tavern meeting?");
      const slot = await engine.timeline.save("mid");
      await playTurn(engine, scene2, "branch line");
      await engine.scene.end(scene2);

      const before = await engine.timeline.events();
      await engine.timeline.load(slot);
      const afterLoad = await engine.timeline.events();
      expect(afterLoad.length).toBeLessThan(before.length);

      const lastId = afterLoad.at(-1)!.id;
      await engine.timeline.rewind(lastId);
      const diff = await engine.timeline.diff("main", engine.timeline.current().name);
      expect(diff.events.onlyA.length + diff.events.onlyB.length).toBeGreaterThan(0);

      const saves = await engine.timeline.saves();
      expect(saves.some((s) => s.label === "mid")).toBe(true);
      const savesYaml = await h.storage.readText("saves.yaml");
      expect(savesYaml).toContain("mid");

      await h.audit({ snapshots: false });
    } finally {
      await h.dispose();
    }
  });

  test("lock release allows reopen on the same root", async () => {
    const llm = streamingLifecycleLlm();
    const h = await openSessionEngine({ preset: lifecyclePreset(), models: { s1: llm.s1, s2: llm.s2 }, sessionId: "sess_lock" });
    try {
      await h.engine.close();
      const e2 = await createEngine({
        root: h.root,
        presets: [lifecyclePreset()],
        models: { s1: llm.s1, s2: llm.s2 },
        sessionId: "sess_lock_2",
      });
      await e2.close();
    } finally {
      await h.dispose();
    }
  });
});
