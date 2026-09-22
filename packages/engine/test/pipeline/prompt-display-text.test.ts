import { describe, expect, test } from "bun:test";
import { localizeDeep } from "@animae/i18n";
import type { Kernel } from "../../src/contracts.ts";
import { liftStringRefs } from "../../src/i18n/string-resolve.ts";
import { appraiseStage } from "../../src/pipeline/appraise.ts";
import { buildPromptSegments } from "../../src/pipeline/prompt.ts";
import type { PromptInput } from "../../src/pipeline/types.ts";
import { charDef, createPipelineKernel } from "./test-kernel.ts";

type Tables = Record<string, Record<string, string>>;

/** String tables held in memory, with the strict (no fallback locale) lookup the engine provides. */
function fakeDisplayText(tables: Tables): NonNullable<Kernel["displayText"]> {
  return {
    resolve: (locale, value) => localizeDeep(liftStringRefs(value), (key) => tables[locale]?.[key] ?? tables.en?.[key] ?? key),
    lookup: (locale, key) => tables[locale]?.[key],
    prepare: async () => {},
  };
}

const TABLES: Tables = {
  "zh-CN": {
    "cue.action.description": "动作提示",
    "event.flirt.description": "调情或示好",
    "character.npc1.name": "白芷",
    "character.npc1.nickname": "芷芷",
    "character.player.name": "顾远",
  },
  en: {
    "cue.action.description": "action hint",
    "character.npc1.name": "Bai Zhi",
    "character.npc1.nickname": "Zhizhi",
    "character.player.name": "Gu Yuan",
  },
};

const scene = { id: "scn_0001", location: "loc", participants: ["player", "npc1"], turn: 1, firstTurn: false };

function renderInput(extra: Partial<PromptInput> = {}): PromptInput {
  return {
    purpose: "render",
    speaker: "npc1",
    addressee: "player",
    scene,
    history: [],
    fieldEffects: {},
    tier: "s1",
    intent: { intent: "respond", scores: { respond: 1 } },
    ...extra,
  };
}

const CUES = { types: { action: { args: { name: { type: "string" as const } }, description: "$t:cue.action.description" } } };

describe("late-bound strings in prompts", () => {
  test("cue descriptions written as $t: keys resolve in the working prompt language", () => {
    const { k } = createPipelineKernel({
      chars: [charDef("npc1"), charDef("player")],
      policy: { cues: CUES },
      i18n: { promptLocale: "zh-CN", outputLocale: "zh-CN", contentLocale: "zh-CN" },
      displayText: fakeDisplayText(TABLES),
    });
    const seg = buildPromptSegments(k, renderInput());
    expect(seg.static).toContain("- action: 动作提示 (args: name)");
    expect(seg.static).not.toContain("$t:");
  });

  test("the prompt locale, not the output locale, picks the language of policy strings", () => {
    const { k } = createPipelineKernel({
      chars: [charDef("npc1"), charDef("player")],
      policy: { cues: CUES },
      i18n: { promptLocale: "zh-CN", outputLocale: "en", contentLocale: "zh-CN" },
      displayText: fakeDisplayText(TABLES),
    });
    expect(buildPromptSegments(k, renderInput()).static).toContain("动作提示");
  });

  test("plain descriptions and kernels without string tables keep the text as written", () => {
    const plain = createPipelineKernel({
      chars: [charDef("npc1"), charDef("player")],
      policy: { cues: { types: { action: { args: { name: { type: "string" as const } }, description: "a plain hint" } } } },
      displayText: fakeDisplayText(TABLES),
    }).k;
    expect(buildPromptSegments(plain, renderInput()).static).toContain("- action: a plain hint");

    const bare = createPipelineKernel({ chars: [charDef("npc1"), charDef("player")], policy: { cues: CUES } }).k;
    expect(buildPromptSegments(bare, renderInput()).static).toContain("$t:cue.action.description");
  });

  test("a key only the fallback language defines still resolves; an undefined key is dropped, not printed", () => {
    const cues = {
      types: {
        action: { args: { name: { type: "string" as const } }, description: "$t:cue.fallback_only.description" },
        sfx: { args: { name: { type: "string" as const } }, description: "$t:cue.nobody_defines.description" },
      },
    };
    const tables: Tables = { ...TABLES, en: { ...TABLES.en!, "cue.fallback_only.description": "english only" } };
    const { k } = createPipelineKernel({
      chars: [charDef("npc1"), charDef("player")],
      policy: { cues },
      i18n: { promptLocale: "zh-CN", outputLocale: "zh-CN", contentLocale: "zh-CN" },
      displayText: fakeDisplayText(tables),
    });
    const text = buildPromptSegments(k, renderInput()).static;
    expect(text).toContain("- action: english only (args: name)");
    expect(text).toContain("- sfx (args: name)");
    expect(text).not.toContain("nobody_defines");
    expect(text).not.toContain("$t:");
  });

  test("event type descriptions in the appraisal prompt resolve too", async () => {
    let dynamic = "";
    const { k } = createPipelineKernel({
      chars: [charDef("npc1"), charDef("player")],
      policy: { events: { types: { flirt: { positive: true, description: "$t:event.flirt.description" } } } },
      i18n: { promptLocale: "zh-CN", outputLocale: "zh-CN", contentLocale: "zh-CN" },
      displayText: fakeDisplayText(TABLES),
      s1Handler: (req) => {
        dynamic = req.segments.dynamic;
        return { type: "flirt", intensity: 0.5, sincerity: 0.5, claims: [], search_terms: [], tags: [], input_class: "normal" };
      },
    });
    const turn = { turnId: "turn_0001", sceneId: "scn_0001", actor: "player", addressee: "npc1", speaker: "npc1", text: "hi", autonomous: false };
    await appraiseStage(k, turn, {
      speaker: "npc1",
      addressee: "npc1",
      actor: "player",
      actorText: "hi",
      scene,
      history: [],
      fieldEffects: {},
    });
    expect(dynamic).toContain("- flirt: 调情或示好 (positive)");
    expect(dynamic).not.toContain("$t:");
  });
});

describe("name glossary for a different output language", () => {
  const cross = (extra: Partial<Kernel["i18n"]> = {}) =>
    createPipelineKernel({
      chars: [charDef("npc1"), charDef("player")],
      i18n: { promptLocale: "zh-CN", outputLocale: "en", contentLocale: "zh-CN", ...extra },
      displayText: fakeDisplayText(TABLES),
    }).k;

  test("lists each character's working-language names with the output-language spelling", () => {
    const seg = buildPromptSegments(cross(), renderInput());
    expect(seg.static).toContain("白芷 → Bai Zhi");
    expect(seg.static).toContain("芷芷 → Zhizhi");
    expect(seg.static).toContain("顾远 → Gu Yuan");
  });

  test("follows the per-turn output language", () => {
    const k = cross({ outputLocale: "zh-CN" });
    expect(buildPromptSegments(k, renderInput()).static).not.toContain("→");
    expect(buildPromptSegments(k, renderInput({ outputLocale: "en" })).static).toContain("白芷 → Bai Zhi");
  });

  test("a language without its own strings gets no glossary instead of fallback-language names", () => {
    expect(buildPromptSegments(cross(), renderInput({ outputLocale: "ja" })).static).not.toContain("→");
  });

  test("same language for content and output, or no string tables: no glossary", () => {
    const same = cross({ outputLocale: "zh-CN" });
    expect(buildPromptSegments(same, renderInput()).static).not.toContain("译名对照");
    const bare = createPipelineKernel({
      chars: [charDef("npc1"), charDef("player")],
      i18n: { promptLocale: "zh-CN", outputLocale: "en", contentLocale: "zh-CN" },
    }).k;
    expect(buildPromptSegments(bare, renderInput()).static).not.toContain("译名对照");
  });

  test("the glossary is part of the render prompt only", () => {
    const seg = buildPromptSegments(cross(), { ...renderInput(), purpose: "appraise", actorText: "hi" });
    expect(seg.static).not.toContain("→");
  });
});
