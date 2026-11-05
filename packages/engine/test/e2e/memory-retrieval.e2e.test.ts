import { describe, expect, test } from "bun:test";
import { artifactPath } from "../../src/timeline/paths.ts";
import { collectTurn, playTurn } from "./session-fixture.ts";
import { assertLogInvariants } from "./session-invariants.ts";
import {
  isUtteranceWithRetrieval,
  memoryStoryLlm,
  memoryStoryPreset,
  openMemoryEngine,
  seedKnowledgeDocs,
  seedPrivateNpc2Memory,
} from "./memory-fixture.ts";

describe("memory retrieval e2e (spec 9, introspect 12)", () => {
  test("multi-scene: utterance retrieval log, reflection, later recall, owner scope, distortion owner", async () => {
    const llm = memoryStoryLlm();
    const h = await openMemoryEngine({
      preset: memoryStoryPreset(),
      models: { s1: llm.s1, s2: llm.s2 },
      mode: "full",
      modelMode: "record",
      sessionId: "mem_retrieval",
      seedExtra: async (s) => {
        await seedKnowledgeDocs(s);
        await seedPrivateNpc2Memory(s);
      },
    });
    try {
      const { engine } = h;
      const scene1 = await engine.scene.start({ location: "tavern", participants: ["player", "npc1", "npc2"] });
      const t1 = await collectTurn(
        engine.scene.turn({ sceneId: scene1, actor: "player", text: "Remember the tavern?", addressee: "npc1" }),
      );
      expect(t1.chunks.some((c) => c.type === "done")).toBe(true);

      const utterances = await engine.timeline.events({ kinds: ["utterance"] });
      const withRetrieval = utterances.filter(isUtteranceWithRetrieval);
      expect(withRetrieval.length).toBeGreaterThan(0);
      for (const u of withRetrieval) {
        for (const hit of u.retrieval!) {
          expect(hit.id).toBeTruthy();
          expect(typeof hit.score).toBe("number");
          expect(hit.kind === "memory" || hit.kind === "knowledge").toBe(true);
          expect(hit.owner).toBe("npc1");
          expect((hit as { text?: string }).text).toBeUndefined();
        }
      }

      await playTurn(engine, scene1, "thank you for sharing");
      await playTurn(engine, scene1, "anything else?");
      await engine.scene.end(scene1);

      const reflected = await engine.timeline.events({ kinds: ["reflection.accepted"] });
      expect(reflected.length).toBeGreaterThan(0);

      const scene2 = await engine.scene.start({ location: "tavern", participants: ["player", "npc1"] });
      await playTurn(engine, scene2, "what do you recall from last time?");
      const tPrivate = await collectTurn(
        engine.scene.turn({ sceneId: scene2, actor: "player", text: "Ben's secret code?", addressee: "npc1" }),
      );
      expect(tPrivate.chunks.some((c) => c.type === "done")).toBe(true);

      const npc1Utterances = (await engine.timeline.events({ kinds: ["utterance"] })).filter(
        (e) => (e as { speaker?: string }).speaker === "npc1",
      );
      const allHits = npc1Utterances.flatMap((e) => (e as { retrieval?: { id: string }[] }).retrieval ?? []);
      expect(allHits.some((h) => h.id === "mem_npc2_private")).toBe(false);

      const scene2Utterances = npc1Utterances.slice(-3);
      const reflectedHit = scene2Utterances.some((u) =>
        ((u as { retrieval?: { id: string }[] }).retrieval ?? []).some((hit) => hit.id.startsWith("sum_")),
      );
      const memArtifact = await h.storage.readText(artifactPath("main", "npc1/memory.jsonl"));
      expect(reflectedHit || (memArtifact ?? "").includes("REFLECTED_TAVERN")).toBe(true);

      const distorted = await engine.timeline.events({ kinds: ["memory.distorted"] });
      if (distorted.length > 0) {
        expect((distorted[0] as { owner?: string }).owner).toBe("npc1");
      }

      const turnId = t1.chunks.find((c): c is Extract<(typeof t1.chunks)[0], { type: "done" }> => c.type === "done")?.turnId;
      expect(turnId).toBeTruthy();
      const ex = engine.explain(turnId!, "player");
      const retrievalChain = ex.chain.filter((c) => c.kind === "retrieval");
      if (retrievalChain.length > 0) {
        expect((retrievalChain[0]!.data as { text?: string }).text).toBeUndefined();
      }

      await engine.scene.end(scene2);
      assertLogInvariants(await engine.timeline.events());
    } finally {
      await h.dispose();
    }
  });
});
