import { test, expect, describe } from "bun:test";
import { buildPromptSegments } from "../../src/pipeline/prompt.ts";
import { createPipelineKernel, charDef } from "./test-kernel.ts";
describe("buildPromptSegments", () => {
  test("deterministic segments and placement", () => {
    const { k, setState } = createPipelineKernel({
      chars: [
        {
          ...charDef("npc1"),
          secrets: [{ id: "s1", text: "hidden truth", tags: ["secret"], unlock: "false" }],
        },
        charDef("player"),
      ],
    });
    setState({
      ...k.timeline.state(),
      characters: {
        ...k.timeline.state().characters,
        npc1: { ...k.timeline.state().characters.npc1!, unlockedSecrets: [] },
      },
    });

    const scene = { id: "scn_0001", location: "loc", participants: ["player", "npc1"], turn: 1, firstTurn: false };
    const input = {
      purpose: "render" as const,
      speaker: "npc1",
      addressee: "player",
      scene,
      history: [],
      fieldEffects: { topic_access: { close: ["forbidden"], open: [] } },
      tier: "s1" as const,
      intent: { intent: "respond", scores: { respond: 1 } },
    };

    const a = buildPromptSegments(k, input);
    const b = buildPromptSegments(k, input);
    expect(a).toEqual(b);
    expect(a.static).toContain("BCP-47");
    expect(a.static).not.toContain("hidden truth");
    expect(a.semiStatic).toContain("scn_0001");
    expect(a.dynamic).toContain("Topics closed: forbidden");
    expect(a.user).toContain("Generate npc1's in-character response");
    expect(a.static).toContain("Output contract");
  });

  test("render user message closes with the output-language directive written in that language", () => {
    const scene = { id: "scn_0001", location: "loc", participants: ["player", "npc1"], turn: 1, firstTurn: false };
    const input = {
      purpose: "render" as const,
      speaker: "npc1",
      addressee: "player",
      scene,
      history: [],
      fieldEffects: {},
      tier: "s1" as const,
      intent: { intent: "respond", scores: { respond: 1 } },
    };
    // Working prompt in one language, player-visible output in another: the last thing the model reads must be the
    // directive in the output language, otherwise persona/examples in the working language win.
    const cross = createPipelineKernel({
      chars: [charDef("npc1"), charDef("player")],
      i18n: { promptLocale: "zh-CN", outputLocale: "en" },
    }).k;
    const toEnglish = buildPromptSegments(cross, input).user;
    expect(toEnglish.trimEnd().endsWith("Internal structured fields may use the working prompt language.")).toBe(true);
    expect(toEnglish).toContain("English (en)");
    const toChinese = buildPromptSegments(cross, { ...input, outputLocale: "zh-CN" }).user;
    expect(toChinese).not.toContain("Internal structured fields");

    // Same language for prompt and output: no duplicate directive.
    const same = createPipelineKernel({
      chars: [charDef("npc1"), charDef("player")],
      i18n: { promptLocale: "en", outputLocale: "en" },
    }).k;
    expect(buildPromptSegments(same, input).user).not.toContain("Internal structured fields");
  });

  test("unlocked secrets appear in static only", () => {
    const { k, setState } = createPipelineKernel({
      chars: [
        {
          ...charDef("npc1"),
          secrets: [{ id: "s1", text: "I know the code", tags: ["x"], unlock: "true" }],
        },
      ],
    });
    setState({
      ...k.timeline.state(),
      characters: {
        ...k.timeline.state().characters,
        npc1: { ...k.timeline.state().characters.npc1!, unlockedSecrets: ["s1"] },
      },
    });
    const seg = buildPromptSegments(k, {
      purpose: "appraise",
      speaker: "npc1",
      addressee: "player",
      scene: { id: "scn_0001", location: "loc", participants: ["player", "npc1"], turn: 1, firstTurn: false },
      history: [],
      fieldEffects: {},
      actorText: "hello",
    });
    expect(seg.static).toContain("I know the code");
  });
});
