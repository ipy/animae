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

describe("gatherKnowledge when failures", () => {
  const doc = (id: string, when: string): KnowledgeDoc => ({
    id,
    name: id,
    description: "test",
    scope: "world",
    inject: "when",
    when,
    body: "BODY",
    priority: 1,
    tags: [],
    path: `world/knowledge/${id}.md`,
    shareable: false,
  });

  test("a condition that cannot be evaluated skips the document and warns once instead of failing the turn", () => {
    const warnings: { code: string; extra?: Record<string, unknown> }[] = [];
    const k = {
      ...fakeKernel([doc("broken", "fields.jealousy == true"), doc("fine", "true")], []),
      warn: (code: string, _message: string, extra?: Record<string, unknown>) => warnings.push({ code, extra }),
    } as unknown as Kernel;
    const ctx = { fields: { active: [] }, world: { vars: {} }, event: { type: "other", tags: [] } };
    const first = gatherKnowledge(k, { owner: "npc", ctx: ctx as never });
    expect(first.when.map((d) => d.id)).toEqual(["fine"]);
    gatherKnowledge(k, { owner: "npc", ctx: ctx as never });
    expect(warnings).toEqual([{ code: "KNOWLEDGE_WHEN_FAILED", extra: { id: "broken", path: "world/knowledge/broken.md" } }]);
  });

  test("a guarded condition on an optional key evaluates normally", () => {
    const k = fakeKernel([doc("guarded", "'jealousy' in fields.active")], []);
    const on = gatherKnowledge(k, { owner: "npc", ctx: { fields: { active: ["jealousy"] } } as never });
    const off = gatherKnowledge(k, { owner: "npc", ctx: { fields: { active: [] } } as never });
    expect(on.when.map((d) => d.id)).toEqual(["guarded"]);
    expect(off.when).toEqual([]);
  });
});
