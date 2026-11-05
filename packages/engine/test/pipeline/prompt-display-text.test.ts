import { afterEach, describe, expect, test } from "bun:test";
import { clearLocalePacks } from "@animae/i18n";
import { localizeDeep } from "@animae/i18n";
import type { Kernel } from "../../src/contracts.ts";
import { liftStringRefs } from "../../src/i18n/string-resolve.ts";
import { appraiseStage } from "../../src/pipeline/appraise.ts";
import { buildPromptSegments } from "../../src/pipeline/prompt.ts";
import type { PromptInput } from "../../src/pipeline/types.ts";
import { FR_TEST_LOCALE, registerFrenchTestPack } from "../helpers/locale-packs.ts";
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
  fr: {
    "cue.action.description": "Indice d'action",
    "event.flirt.description": "Flirt ou marques d'affection",
    "character.npc1.name": "Blanche",
    "character.npc1.nickname": "Blanchette",
    "character.player.name": "Guillaume",
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
    tier: "standard",
    intent: { intent: "respond", scores: { respond: 1 } },
    ...extra,
  };
}

const CUES = { types: { action: { args: { name: { type: "string" as const } }, description: "$t:cue.action.description" } } };

describe("late-bound strings in prompts", () => {
  let offFrench: (() => void) | undefined;

  afterEach(() => {
    offFrench?.();
    offFrench = undefined;
    clearLocalePacks();
  });

  test("cue descriptions written as $t: keys resolve in the working prompt language", () => {
    offFrench = registerFrenchTestPack();
    const { k } = createPipelineKernel({
      chars: [charDef("npc1"), charDef("player")],
      policy: { cues: CUES },
      i18n: { promptLocale: FR_TEST_LOCALE, outputLocale: FR_TEST_LOCALE, contentLocale: FR_TEST_LOCALE },
      displayText: fakeDisplayText(TABLES),
    });
    const seg = buildPromptSegments(k, renderInput());
    expect(seg.static).toContain("- action: Indice d'action (args: name)");
    expect(seg.static).not.toContain("$t:");
  });

  test("the prompt locale, not the output locale, picks the language of policy strings", () => {
    offFrench = registerFrenchTestPack();
    const { k } = createPipelineKernel({
      chars: [charDef("npc1"), charDef("player")],
      policy: { cues: CUES },
      i18n: { promptLocale: FR_TEST_LOCALE, outputLocale: "en", contentLocale: FR_TEST_LOCALE },
      displayText: fakeDisplayText(TABLES),
    });
    expect(buildPromptSegments(k, renderInput()).static).toContain("Indice d'action");
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
    offFrench = registerFrenchTestPack();
    const { k } = createPipelineKernel({
      chars: [charDef("npc1"), charDef("player")],
      policy: { cues },
      i18n: { promptLocale: FR_TEST_LOCALE, outputLocale: FR_TEST_LOCALE, contentLocale: FR_TEST_LOCALE },
      displayText: fakeDisplayText(tables),
    });
    const text = buildPromptSegments(k, renderInput()).static;
    expect(text).toContain("- action: english only (args: name)");
    expect(text).toContain("- sfx (args: name)");
    expect(text).not.toContain("nobody_defines");
    expect(text).not.toContain("$t:");
  });

  test("event type descriptions in the appraisal prompt resolve too", async () => {
    offFrench = registerFrenchTestPack();
    let staticText = "";
    const { k } = createPipelineKernel({
      chars: [charDef("npc1"), charDef("player")],
      policy: { events: { types: { flirt: { positive: true, description: "$t:event.flirt.description" } } } },
      i18n: { promptLocale: FR_TEST_LOCALE, outputLocale: FR_TEST_LOCALE, contentLocale: FR_TEST_LOCALE },
      displayText: fakeDisplayText(TABLES),
      s1Handler: (req) => {
        staticText = req.segments.static;
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
    expect(staticText).toContain("- flirt : Flirt ou marques d'affection [positif]");
    expect(staticText).not.toContain("$t:");
  });
});

describe("name glossary for a different output language", () => {
  let offFrench: (() => void) | undefined;

  afterEach(() => {
    offFrench?.();
    offFrench = undefined;
    clearLocalePacks();
  });

  const cross = (extra: Partial<Kernel["i18n"]> = {}) => {
    offFrench = registerFrenchTestPack();
    return createPipelineKernel({
      chars: [charDef("npc1"), charDef("player")],
      i18n: { promptLocale: FR_TEST_LOCALE, outputLocale: "en", contentLocale: FR_TEST_LOCALE, ...extra },
      displayText: fakeDisplayText(TABLES),
    }).k;
  };

  test("lists each character's working-language names with the output-language spelling", () => {
    const seg = buildPromptSegments(cross(), renderInput());
    expect(seg.static).toContain("npc1 → Bai Zhi");
    expect(seg.static).toContain("player → Gu Yuan");
    expect(seg.static).not.toContain("Zhizhi");
  });

  test("a character shown by its card nickname is translated with the nickname, not the full name", () => {
    const withNick = charDef("player");
    withNick.card.identity.nickname = "Directrice";
    const tables: Tables = {
      fr: { ...TABLES.fr! },
      en: { ...TABLES.en!, "character.player.nickname": "Director" },
    };
    offFrench = registerFrenchTestPack();
    const { k } = createPipelineKernel({
      chars: [charDef("npc1"), withNick],
      i18n: { promptLocale: FR_TEST_LOCALE, outputLocale: "en", contentLocale: FR_TEST_LOCALE },
      displayText: fakeDisplayText(tables),
    });
    const text = buildPromptSegments(k, renderInput()).static;
    expect(text).toContain("npc1 → Bai Zhi");
    expect(text).toContain("Directrice → Director");
    expect(text).not.toContain("Gu Yuan");
  });

  test("follows the per-turn output language", () => {
    const k = cross({ outputLocale: FR_TEST_LOCALE });
    expect(buildPromptSegments(k, renderInput()).static).not.toContain("→");
    expect(buildPromptSegments(k, renderInput({ outputLocale: "en" })).static).toContain("npc1 → Bai Zhi");
  });

  test("a language without its own strings gets no glossary instead of fallback-language names", () => {
    expect(buildPromptSegments(cross(), renderInput({ outputLocale: "ja" })).static).not.toContain("→");
  });

  test("same language for content and output, or no string tables: no glossary", () => {
    const same = cross({ outputLocale: FR_TEST_LOCALE });
    expect(buildPromptSegments(same, renderInput()).static).not.toMatch(/Name glossary|Glossaire des noms/);
    const bare = createPipelineKernel({
      chars: [charDef("npc1"), charDef("player")],
      i18n: { promptLocale: FR_TEST_LOCALE, outputLocale: "en", contentLocale: FR_TEST_LOCALE },
    }).k;
    expect(buildPromptSegments(bare, renderInput()).static).not.toMatch(/Name glossary|Glossaire des noms/);
  });

  test("the glossary is part of the render prompt only", () => {
    const seg = buildPromptSegments(cross(), { ...renderInput(), purpose: "appraise", actorText: "hi" });
    expect(seg.static).not.toContain("→");
  });
});
