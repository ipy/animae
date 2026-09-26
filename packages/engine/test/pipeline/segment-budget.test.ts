import { test, expect, describe } from "bun:test";
import { buildPromptSegments } from "../../src/pipeline/prompt.ts";
import { assembleBudgetSections } from "../../src/pipeline/section-budget.ts";
import { createPipelineKernel, charDef } from "./test-kernel.ts";

describe("maxSegmentChars", () => {
  test("drops low-priority static sections without truncation marker", () => {
    const { k } = createPipelineKernel({
      policy: { render: { retryOnMismatch: 0, recentTurns: 12, maxSegmentChars: { static: 200 } } },
      knowledge: [
        {
          id: "k_big",
          path: "world/knowledge/k_big.md",
          name: "Big",
          description: "d",
          body: "x".repeat(500),
          inject: "always",
          scope: "world",
          shareable: false,
          tags: [],
          priority: 10,
        },
      ],
      chars: [charDef("npc1"), charDef("player")],
    });
    const seg = buildPromptSegments(k, {
      purpose: "render",
      speaker: "npc1",
      addressee: "player",
      scene: { id: "scn_0001", location: "loc", participants: ["player", "npc1"], turn: 1, firstTurn: false },
      history: [],
      fieldEffects: {},
    });
    expect(seg.static.length).toBeLessThanOrEqual(200);
    expect(seg.static).not.toContain("truncated to segment budget");
    expect(seg.diagnostics?.droppedSections?.length).toBeGreaterThan(0);
  });

  test("static cap preserves character identity before low-priority tail", () => {
    const { k } = createPipelineKernel({
      policy: { render: { retryOnMismatch: 0, recentTurns: 12, maxSegmentChars: { static: 4000 } } },
      knowledge: [
        {
          id: "k_big",
          path: "world/knowledge/k_big.md",
          name: "Big",
          description: "d",
          body: "y".repeat(3000),
          inject: "always",
          scope: "world",
          shareable: false,
          tags: [],
          priority: 5,
        },
      ],
      chars: [
        {
          ...charDef("npc1"),
          persona: "p".repeat(2500),
          card: {
            ...charDef("npc1").card,
            identity: { name: "TestNpc", summary: "Short summary line.", style_examples: [] },
            constraints: {
              motives: [],
              taboos: [],
              bottom_lines: [{ id: "b1", text: "Never break character.", hardness: "hard" as const, tags: [] }],
            },
          },
        },
        charDef("player"),
      ],
    });
    const seg = buildPromptSegments(k, {
      purpose: "render",
      speaker: "npc1",
      addressee: "player",
      scene: { id: "scn_0001", location: "loc", participants: ["player", "npc1"], turn: 1, firstTurn: false },
      history: [],
      fieldEffects: {},
    });
    expect(seg.static.length).toBeLessThanOrEqual(4000);
    expect(seg.static).toContain("TestNpc");
    expect(seg.static).toContain("Never break character");
  });
});

describe("item-level budgeting of list sections", () => {
  const list = (id: string, priority: number, heading: string, items: string[]) => {
    const compose = (kept: string[]) => [heading, kept.join("\n\n")].join("\n\n");
    return { id, priority, text: compose(items), items: { list: items, compose } };
  };

  test("a list that does not fit keeps its most important items instead of vanishing", () => {
    const items = ["A".repeat(100), "B".repeat(100), "C".repeat(100)];
    const { text, dropped } = assembleBudgetSections(
      [{ id: "intent", priority: 70, text: "intent line" }, list("knowledge", 50, "Heading", items)],
      260,
    );
    expect(text).toContain("intent line");
    expect(text).toContain("Heading");
    expect(text).toContain("A".repeat(100));
    expect(text).toContain("B".repeat(100));
    expect(text).not.toContain("C".repeat(100));
    expect(text.length).toBeLessThanOrEqual(260);
    expect(dropped).toEqual(["knowledge[1 omitted]"]);
  });

  test("an item too large for the room is skipped while smaller later items still fit", () => {
    const items = ["A".repeat(50), "B".repeat(400), "C".repeat(50)];
    const { text } = assembleBudgetSections([list("knowledge", 50, "H", items)], 200);
    expect(text).toContain("A".repeat(50));
    expect(text).not.toContain("B".repeat(400));
    expect(text).toContain("C".repeat(50));
  });

  test("a list with no fitting item is dropped whole and sections without items behave as before", () => {
    const { text, dropped } = assembleBudgetSections(
      [
        { id: "intent", priority: 70, text: "x".repeat(90) },
        list("knowledge", 50, "H", ["y".repeat(80)]),
        { id: "plain", priority: 40, text: "z".repeat(10) },
      ],
      100,
    );
    expect(text).toContain("x".repeat(90));
    expect(text).not.toContain("y");
    expect(dropped).toContain("knowledge");
    expect(dropped).toContain("plain");
  });

  test("everything fits: output is identical to the plain sections", () => {
    const withItems = assembleBudgetSections([list("knowledge", 50, "H", ["a", "b"])], 1000);
    const plain = assembleBudgetSections([{ id: "knowledge", priority: 50, text: "H\n\na\n\nb" }], 1000);
    expect(withItems).toEqual(plain);
  });
});

describe("contextual knowledge under a tight dynamic budget", () => {
  const doc = (id: string, priority: number, body: string) => ({
    id,
    path: `world/knowledge/${id}.md`,
    name: `Doc ${id}`,
    description: "d",
    body,
    inject: "when" as const,
    when: "true",
    scope: "world",
    shareable: false,
    tags: [],
    priority,
  });

  test("the highest-priority documents survive and the omission is reported", () => {
    const { k } = createPipelineKernel({
      policy: { render: { retryOnMismatch: 0, recentTurns: 12, maxSegmentChars: { dynamic: 420 } } },
      knowledge: [
        doc("low", 10, `LOW_${"l".repeat(150)}`),
        doc("high", 90, `HIGH_${"h".repeat(150)}`),
        doc("mid", 50, `MID_${"m".repeat(150)}`),
      ] as never,
      chars: [charDef("npc1"), charDef("player")],
    });
    const seg = buildPromptSegments(k, {
      purpose: "render",
      speaker: "npc1",
      addressee: "player",
      scene: { id: "scn_0001", location: "loc", participants: ["player", "npc1"], turn: 1, firstTurn: false },
      history: [],
      fieldEffects: {},
    });
    expect(seg.dynamic.length).toBeLessThanOrEqual(420);
    expect(seg.dynamic).toContain("HIGH_");
    expect(seg.dynamic).toContain("MID_");
    expect(seg.dynamic).not.toContain("LOW_");
    expect(seg.dynamic.indexOf("HIGH_")).toBeLessThan(seg.dynamic.indexOf("MID_"));
    expect(seg.diagnostics?.droppedSections?.some((d) => d.startsWith("contextual_knowledge"))).toBe(true);
  });
});
