import { test, expect, describe } from "bun:test";
import { buildPromptSegments } from "../../src/pipeline/prompt.ts";
import { createPipelineKernel, charDef } from "./test-kernel.ts";

describe("maxSegmentChars", () => {
  test("truncates static always knowledge with marker", () => {
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
    expect(seg.static).toContain("truncated to segment budget");
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
    expect(seg.static).toContain("You are TestNpc");
    expect(seg.static).toContain("Never break character");
  });
});
