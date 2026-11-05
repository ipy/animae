import { describe, expect, test } from "bun:test";
import { collectTurn } from "./session-fixture.ts";
import {
  deterministicEmbeddingPort,
  isUtteranceWithRetrieval,
  memoryKnowledgePreset,
  memoryStoryLlm,
  openMemoryEngine,
  seedKnowledgeDocs,
  seedVectorKnowledgePair,
} from "./memory-fixture.ts";
import type { PromptSegments } from "../../src/ports.ts";

describe("memory knowledge e2e (spec 9, inject + vector blend)", () => {
  test("always, when, and on-demand knowledge appear in S2 prompt segments as specified", async () => {
    const captured: PromptSegments[] = [];
    const llm = memoryStoryLlm({
      s2: (req) => {
        if (req.label === "render") captured.push(req.segments);
        return undefined;
      },
    });
    const h = await openMemoryEngine({
      preset: memoryKnowledgePreset(0),
      models: { s1: llm.s1, s2: llm.s2 },
      mode: "full",
      seedExtra: seedKnowledgeDocs,
    });
    try {
      const sceneId = await h.engine.scene.start({ location: "tavern", participants: ["player", "npc1"] });
      await collectTurn(h.engine.scene.turn({ sceneId, actor: "player", text: "hello", addressee: "npc1" }));
      await collectTurn(h.engine.scene.turn({ sceneId, actor: "player", text: "thank you", addressee: "npc1" }));
      expect(captured.length).toBeGreaterThan(0);
      const blob = captured.map((seg) => `${seg.static}\n${seg.semiStatic}\n${seg.dynamic}`).join("\n");
      expect(blob).toContain("ALWAYS_LORE_BODY");
      expect(blob).toContain("WHEN_CARE_BODY");
      expect(blob).not.toContain("ON_DEMAND_INDEX_BODY");
      await h.engine.scene.end(sceneId);
    } finally {
      await h.dispose();
    }
  });

  test("vector weight > 0 changes knowledge hit ordering vs vector weight 0", async () => {
    const orderWith = async (vectorWeight: number): Promise<string[]> => {
      const llm = memoryStoryLlm({
        s1: (req, n) => {
          if (req.label === "appraise") {
            return {
              type: "chat",
              intensity: 0.4,
              sincerity: 0.9,
              claims: [],
              search_terms: ["alpha", "beta"],
              tags: [],
              input_class: "normal",
            };
          }
          return undefined;
        },
      });
      const h = await openMemoryEngine({
        preset: memoryKnowledgePreset(vectorWeight),
        models: { s1: llm.s1, s2: llm.s2 },
        mode: "full",
        ports: { embedding: deterministicEmbeddingPort() },
        seedExtra: seedVectorKnowledgePair,
      });
      try {
        const sceneId = await h.engine.scene.start({ location: "tavern", participants: ["player", "npc1"] });
        await collectTurn(
          h.engine.scene.turn({ sceneId, actor: "player", text: "search docs", addressee: "npc1" }),
        );
        const u = (await h.engine.timeline.events({ kinds: ["utterance"] })).find(isUtteranceWithRetrieval);
        await h.engine.scene.end(sceneId);
        const knowledge = (u?.retrieval ?? []).filter((hit) => hit.kind === "knowledge");
        return knowledge.map((k) => k.id);
      } finally {
        await h.dispose();
      }
    };

    const withVector = await orderWith(0.35);
    const withoutVector = await orderWith(0);
    expect(withVector.length).toBeGreaterThanOrEqual(2);
    expect(withoutVector.length).toBeGreaterThanOrEqual(2);
    expect(withVector[0]).not.toBe(withoutVector[0]);
  });
});
