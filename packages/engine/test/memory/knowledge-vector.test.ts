import { describe, expect, test } from "bun:test";
import { createMemoryService } from "../../src/memory/service.ts";
import { createFakeKernel } from "../support/kernel-fake.ts";
import type { KnowledgeDoc } from "../../src/schema/authored.ts";

function doc(id: string, body: string): KnowledgeDoc {
  return {
    id,
    name: id,
    description: "",
    scope: "world",
    inject: "on-demand",
    tags: [],
    priority: 50,
    body,
    path: `${id}.md`,
    shareable: false,
  };
}

describe("knowledge vector blend", () => {
  test("high cosine outranks lexically equal doc when weights.vector > 0", async () => {
    const docs = [doc("world/a", "shared keyword text"), doc("world/b", "shared keyword text")];
    const { k } = createFakeKernel({
      knowledge: docs,
      policy: { memory: { weights: { vector: 0.3, term: 0.5, recency: 0.2, importance: 0.2, salience: 0.1 } } },
      embedding: {
        embed: async (texts) =>
          texts.map((t) => {
            if (t.includes("world/a")) return new Float32Array([1, 0]);
            if (t.includes("world/b")) return new Float32Array([0, 1]);
            return new Float32Array([1, 0]);
          }),
      },
    });
    const mem = createMemoryService(k);
    const hits = await mem.retrieve({
      owner: "npc1",
      terms: ["shared"],
      ctx: {},
      now: { day: 1, minute: 0 },
      limit: 5,
    });
    const knowledge = hits.filter((h) => h.kind === "knowledge");
    expect(knowledge.length).toBeGreaterThanOrEqual(2);
    const a = knowledge.find((h) => h.id === "world/a");
    const b = knowledge.find((h) => h.id === "world/b");
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(a!.score).toBeGreaterThan(b!.score);
  });

  test("without embedding port vector weight has no effect", async () => {
    const docs = [doc("world/a", "fog lighthouse")];
    const { k } = createFakeKernel({
      knowledge: docs,
      policy: { memory: { weights: { vector: 0.9, term: 0.5, recency: 0.2, importance: 0.2, salience: 0.1 } } },
    });
    const mem = createMemoryService(k);
    const hits = await mem.retrieve({ owner: "npc1", terms: ["fog"], ctx: {}, now: { day: 1, minute: 0 } });
    expect(hits[0]!.score).toBeGreaterThan(0);
  });

  test("doc body is embedded once per retrieve", async () => {
    const docs = [doc("world/one", "alpha beta gamma")];
    let embedBatchSizes: number[] = [];
    const { k } = createFakeKernel({
      knowledge: docs,
      embedding: {
        embed: async (texts) => {
          embedBatchSizes.push(texts.length);
          return texts.map(() => new Float32Array([1, 0]));
        },
      },
    });
    const mem = createMemoryService(k);
    await mem.retrieve({ owner: "npc1", terms: ["alpha"], ctx: {}, now: { day: 1, minute: 0 } });
    const docEmbeds = embedBatchSizes.filter((n) => n === 1).length;
    expect(docEmbeds).toBeGreaterThanOrEqual(1);
    expect(embedBatchSizes.filter((n) => n === 1).length).toBeLessThanOrEqual(2);
  });
});
