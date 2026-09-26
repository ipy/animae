import { describe, expect, test } from "bun:test";
import { buildPromptSegments } from "../../src/pipeline/prompt.ts";
import type { RetrievalHit } from "../../src/contracts.ts";
import { createPipelineKernel, charDef } from "./test-kernel.ts";

const scene = { id: "scn_0001", location: "loc", participants: ["player", "npc1"], turn: 1, firstTurn: false };

function doc(id: string, body: string, name = `Doc ${id}`) {
  return {
    id,
    path: `world/knowledge/${id}.md`,
    name,
    description: `about ${id}`,
    body,
    inject: "on-demand" as const,
    scope: "world",
    shareable: false,
    tags: [],
    priority: 10,
  };
}

function knowledgeHit(d: { id: string; body: string }, score: number): RetrievalHit {
  return { kind: "knowledge", id: d.id, text: d.body, score, doc: d as never };
}

function memoryHit(id: string, text: string, score: number, extra: Partial<RetrievalHit> = {}): RetrievalHit {
  return { kind: "memory", id, text, score, ...extra };
}

function dynamic(opts: { hits: RetrievalHit[]; policy?: object; i18n?: object; tier?: "s1" | "s2" }) {
  const { k } = createPipelineKernel({
    chars: [charDef("npc1"), charDef("player")],
    ...(opts.policy ? { policy: opts.policy as never } : {}),
    ...(opts.i18n ? { i18n: opts.i18n as never } : {}),
  });
  return buildPromptSegments(k, {
    purpose: "render",
    speaker: "npc1",
    addressee: "player",
    scene,
    history: [],
    fieldEffects: {},
    tier: opts.tier ?? "s1",
    hits: opts.hits,
  } as never).dynamic;
}

describe("recalled material in the prompt", () => {
  test("lines carry content only: no ids, no scores, no retrieval bookkeeping", () => {
    const out = dynamic({
      hits: [memoryHit("mem_1", "Bai Zhi promised to water the ferns.", 0.9), knowledgeHit(doc("lore", "The greenhouse sits on the river."), 0.7)],
    });
    expect(out).toContain("- Bai Zhi promised to water the ferns.");
    expect(out).toContain("- [Doc lore] The greenhouse sits on the river.");
    expect(out).not.toMatch(/score=|mem_1|\(knowledge:|\(memory:/);
  });

  test("loosely related lore is capped in count and length, best first; memories are never crowded out", () => {
    const long = "Sentence one is here. ".repeat(40);
    const lore = ["a", "b", "c", "d", "e"].map((id, n) => knowledgeHit(doc(id, long), 0.8 - n * 0.01));
    const out = dynamic({
      hits: [...lore, memoryHit("mem_1", "A personal memory.", 0.1)],
      policy: { render: { retryOnMismatch: 0, recentTurns: 12, recall: { maxKnowledge: 2, knowledgeChars: 90 } } },
    });
    expect((out.match(/\[Doc /g) ?? []).length).toBe(2);
    expect(out).toContain("[Doc a]");
    expect(out).toContain("[Doc b]");
    expect(out).not.toContain("[Doc c]");
    expect(out).toContain("A personal memory.");
    for (const line of out.split("\n").filter((l) => l.startsWith("- [Doc"))) expect(line.length).toBeLessThanOrEqual(120);
  });

  test("a document the prompt already carries is not recalled a second time", () => {
    const always = { ...doc("lore", "The greenhouse sits on the river."), inject: "always" as const };
    const other = doc("docks", "The docks flood in spring.");
    const { k } = createPipelineKernel({ chars: [charDef("npc1"), charDef("player")], knowledge: [always] as never });
    const seg = buildPromptSegments(k, {
      purpose: "render",
      speaker: "npc1",
      addressee: "player",
      scene,
      history: [],
      fieldEffects: {},
      tier: "s1",
      hits: [knowledgeHit(always, 0.9), knowledgeHit(other, 0.5), memoryHit("mem_1", "A personal memory.", 0.1)],
    } as never);
    expect(seg.static).toContain("The greenhouse sits on the river.");
    expect(seg.dynamic).not.toContain("The greenhouse sits on the river.");
    expect(seg.dynamic).toContain("[Doc docks]");
    expect(seg.dynamic).toContain("A personal memory.");
  });

  test("a repeated document still counts toward the cap, so weaker lore does not fill its place", () => {
    const always = { ...doc("lore", "The greenhouse sits on the river."), inject: "always" as const };
    const { k } = createPipelineKernel({
      chars: [charDef("npc1"), charDef("player")],
      knowledge: [always] as never,
      policy: { render: { retryOnMismatch: 0, recentTurns: 12, recall: { maxKnowledge: 2 } } } as never,
    });
    const seg = buildPromptSegments(k, {
      purpose: "render",
      speaker: "npc1",
      addressee: "player",
      scene,
      history: [],
      fieldEffects: {},
      tier: "s1",
      hits: [knowledgeHit(always, 0.9), knowledgeHit(doc("a", "Lore A."), 0.6), knowledgeHit(doc("b", "Lore B."), 0.5)],
    } as never);
    expect(seg.dynamic).toContain("[Doc a]");
    expect(seg.dynamic).not.toContain("[Doc b]");
  });

  test("a hazy memory explains itself in the prompt language, not in the engine's developer English", () => {
    const hit = memoryHit("mem_1", "Zhi opened the door.", 0.9, {
      distortion: "Emphasise emotional intensity and certainty when recalling this memory.",
      distortionKind: "intensify",
    });
    const zh = dynamic({ hits: [hit], i18n: { promptLocale: "zh-CN", outputLocale: "zh-CN" } });
    expect(zh).toContain("记忆有些模糊");
    expect(zh).not.toMatch(/Emphasise|memory\.|\.。/);
    const en = dynamic({ hits: [hit] });
    expect(en).toContain("Hazy memory");
    expect(en).not.toMatch(/\.\./);
  });

  test("S2 can read what was cut: the truncated lore line names the document id", () => {
    const long = "A fairly long sentence about the river docks. ".repeat(30);
    const hits = [knowledgeHit(doc("river", long), 0.8)];
    const policy = { render: { retryOnMismatch: 0, recentTurns: 12, recall: { knowledgeChars: 100 } } };
    expect(dynamic({ hits, policy, tier: "s2" })).toContain("[river]");
    expect(dynamic({ hits, policy, tier: "s1" })).not.toContain("[river]");
  });

  test("the knowledge index lists ids, because the read tool takes an id", () => {
    const { k } = createPipelineKernel({
      chars: [charDef("npc1"), charDef("player")],
      knowledge: [doc("world/factions/anvil", "body", "Anvil")] as never,
    });
    const seg = buildPromptSegments(k, {
      purpose: "render",
      speaker: "npc1",
      addressee: "player",
      scene,
      history: [],
      fieldEffects: {},
      tier: "s2",
    } as never);
    expect(seg.semiStatic).toContain("Anvil [world/factions/anvil]: about world/factions/anvil");
  });
});
