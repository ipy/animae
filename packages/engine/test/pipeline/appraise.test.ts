import { test, expect, describe } from "bun:test";
import { appraiseStage } from "../../src/pipeline/appraise.ts";
import { createPipelineKernel } from "./test-kernel.ts";

describe("appraiseStage", () => {
  test("post-process unknown type and clamps", async () => {
    const { k } = createPipelineKernel({
      policy: {
        events: { types: { chat: { positive: true } } },
        safety: { enabled: true, log: true, response: "in_character" },
      },
      s1Handler: () => ({
        type: "unknown_type",
        intensity: 2,
        sincerity: -1,
        claims: [],
        search_terms: ["a"],
        tags: [" Tag "],
        input_class: "normal",
        safety: "self_harm",
      }),
    });

    const turn = { turnId: "turn_0001", sceneId: "scn_0001", actor: "player", addressee: "npc1", speaker: "npc1", text: "x", autonomous: false };
    const { appraisal, drafts, safety } = await appraiseStage(k, turn, {
      speaker: "npc1",
      addressee: "npc1",
      actor: "player",
      actorText: "x",
      scene: { id: "scn_0001", location: "loc", participants: ["player", "npc1"], turn: 1, firstTurn: false },
      history: [],
      fieldEffects: {},
    });

    expect(appraisal.type).toBe("other");
    expect(appraisal.intensity).toBe(1);
    expect(appraisal.sincerity).toBe(0);
    expect(appraisal.tags).toEqual(["tag"]);
    expect(drafts.some((d) => d.kind === "input.classified")).toBe(true);
    expect(drafts.some((d) => d.kind === "safety.flagged")).toBe(true);
    expect(safety?.category).toBe("self_harm");
  });
});
