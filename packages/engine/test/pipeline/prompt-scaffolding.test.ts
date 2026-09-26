import { describe, expect, test } from "bun:test";
import { buildPromptSegments } from "../../src/pipeline/prompt.ts";
import { buildS2Tools } from "../../src/pipeline/render.ts";
import { lintAssembledPrompt } from "../../src/pipeline/prompt-lint.ts";
import { createPipelineKernel, charDef } from "./test-kernel.ts";

const scene = { id: "scn_0001", location: "loc", participants: ["player", "npc1"], turn: 1, firstTurn: false };

describe("prompt scaffolding quality", () => {
  test("render intent_realized rules are not duplicated across static and dynamic", () => {
    const { k } = createPipelineKernel({ chars: [charDef("npc1"), charDef("player")] });
    const input = {
      purpose: "render" as const,
      speaker: "npc1" as const,
      addressee: "player" as const,
      scene,
      history: [],
      fieldEffects: {},
      tier: "s1" as const,
      intent: { intent: "respond", scores: { respond: 1 } },
    };
    const seg = buildPromptSegments(k, input);
    const blob = [seg.static, seg.dynamic].join("\n");
    expect(blob.match(/intent_realized/gi)?.length ?? 0).toBeLessThanOrEqual(2);
    expect(seg.dynamic).toContain("Decided intent this turn");
    expect(seg.dynamic).not.toMatch(/intent_realized.*intent_realized/s);
  });

  test("S2 tool descriptions follow prompt locale", () => {
    const { k } = createPipelineKernel({
      chars: [charDef("npc1"), charDef("player")],
      i18n: { promptLocale: "zh-CN", outputLocale: "zh-CN" },
    });
    const tools = buildS2Tools(k, "npc1");
    expect(tools[0]!.description).toMatch(/检索|关键词/);
    expect(tools[1]!.description).toMatch(/id|全文/);
    expect(tools[0]!.description).not.toMatch(/^Search memories/);
  });

  test("assembled render prompt passes lint (en kernel)", () => {
    const { k } = createPipelineKernel({ chars: [charDef("npc1"), charDef("player")] });
    const seg = buildPromptSegments(k, {
      purpose: "render",
      speaker: "npc1",
      addressee: "player",
      scene,
      history: [],
      fieldEffects: {},
      tier: "s1",
      intent: { intent: "respond", scores: { respond: 1 } },
    });
    const blob = [seg.static, seg.semiStatic, seg.dynamic, seg.user].join("\n");
    expect(lintAssembledPrompt(blob)).toEqual([]);
  });
});
