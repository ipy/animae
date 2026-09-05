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
    expect(a.user).toContain("Generate your in-character response");
    expect(a.static).toContain("Output contract");
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
