import { describe, expect, test } from "bun:test";
import { gatherKnowledge } from "../../src/memory/knowledge.ts";
import { createCelEngine } from "../../src/rules/cel.ts";
import type { KnowledgeDoc } from "../../src/schema/authored.ts";
import type { Kernel } from "../../src/contracts.ts";

function fakeKernel(docs: KnowledgeDoc[], tags: string[]): Kernel {
  const cel = createCelEngine();
  return {
    policy: { memory: { indexMax: 0, k: 5 } },
    rules: { cel },
    catalog: { knowledge: () => docs, character: () => undefined, location: () => undefined },
  } as unknown as Kernel;
}

describe("gatherKnowledge model.tags", () => {
  test("injects doc when tier tag matches port", () => {
    const docs: KnowledgeDoc[] = [
      {
        id: "tier-a-doc",
        name: "Tier A",
        description: "test",
        scope: "world",
        inject: "when",
        when: "'tier:a' in model.tags",
        body: "TIER_A_BODY",
        priority: 1,
        tags: [],
        path: "world/knowledge/tier-a.md",
        shareable: false,
      },
    ];
    const k = fakeKernel(docs, ["tier:a"]);
    const ctx = {
      model: { slot: "s1", tags: ["tier:a"] },
      world: { vars: {} },
      event: { type: "other", tags: [] },
    };
    const inj = gatherKnowledge(k, { owner: "npc", ctx: ctx as never });
    expect(inj.when.map((d) => d.id)).toContain("tier-a-doc");
  });

  test("empty ctx does not throw on model.tags when expr", () => {
    const docs: KnowledgeDoc[] = [
      {
        id: "tier-a-doc",
        name: "Tier A",
        description: "test",
        scope: "world",
        inject: "when",
        when: "'tier:a' in model.tags",
        body: "TIER_A_BODY",
        priority: 1,
        tags: [],
        path: "world/knowledge/tier-a.md",
        shareable: false,
      },
    ];
    const k = fakeKernel(docs, []);
    const inj = gatherKnowledge(k, { owner: "npc", ctx: {} as never });
    expect(inj.when.length).toBe(0);
  });

  test("skips doc when tag missing", () => {
    const docs: KnowledgeDoc[] = [
      {
        id: "tier-a-doc",
        name: "Tier A",
        description: "test",
        scope: "world",
        inject: "when",
        when: "'tier:a' in model.tags",
        body: "TIER_A_BODY",
        priority: 1,
        tags: [],
        path: "world/knowledge/tier-a.md",
        shareable: false,
      },
    ];
    const k = fakeKernel(docs, []);
    const ctx = { model: { slot: "s1", tags: [] as string[] }, world: { vars: {} }, event: { type: "other", tags: [] } };
    const inj = gatherKnowledge(k, { owner: "npc", ctx: ctx as never });
    expect(inj.when.length).toBe(0);
  });
});
