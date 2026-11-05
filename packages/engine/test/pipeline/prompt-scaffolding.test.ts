import { afterEach, describe, expect, test } from "bun:test";
import { clearLocalePacks } from "@animae/i18n";
import { buildPromptSegments } from "../../src/pipeline/prompt.ts";
import { buildS2Tools } from "../../src/pipeline/render.ts";
import { lintAssembledPrompt } from "../../src/pipeline/prompt-lint.ts";
import { FR_TEST_LOCALE, registerFrenchTestPack } from "../helpers/locale-packs.ts";
import { createPipelineKernel, charDef } from "./test-kernel.ts";

const scene = { id: "scn_0001", location: "loc", participants: ["player", "npc1"], turn: 1, firstTurn: false };

describe("prompt scaffolding quality", () => {
  let offFrench: (() => void) | undefined;
  afterEach(() => {
    offFrench?.();
    offFrench = undefined;
    clearLocalePacks();
  });

  test("render intent_realized rules are not duplicated across static and dynamic", () => {
    const { k } = createPipelineKernel({ chars: [charDef("npc1"), charDef("player")] });
    const input = {
      purpose: "render" as const,
      speaker: "npc1" as const,
      addressee: "player" as const,
      scene,
      history: [],
      fieldEffects: {},
      tier: "standard" as const,
      intent: { intent: "respond", scores: { respond: 1 } },
    };
    const seg = buildPromptSegments(k, input);
    const blob = [seg.static, seg.dynamic].join("\n");
    expect(blob.match(/intent_realized/gi)?.length ?? 0).toBeLessThanOrEqual(2);
    expect(seg.dynamic).toContain("Decided intent this turn");
    expect(seg.dynamic).not.toMatch(/intent_realized.*intent_realized/s);
  });

  test("S2 tool descriptions follow prompt locale", () => {
    offFrench = registerFrenchTestPack();
    const { k } = createPipelineKernel({
      chars: [charDef("npc1"), charDef("player")],
      i18n: { promptLocale: FR_TEST_LOCALE, outputLocale: FR_TEST_LOCALE },
    });
    const tools = buildS2Tools(k, "npc1");
    expect(tools[0]!.description).toMatch(/Recherchez|mots-clés/i);
    expect(tools[1]!.description).toMatch(/identifiant|index/i);
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
      tier: "standard",
      intent: { intent: "respond", scores: { respond: 1 } },
    });
    const blob = [seg.static, seg.semiStatic, seg.dynamic, seg.user].join("\n");
    expect(lintAssembledPrompt(blob)).toEqual([]);
  });
});
