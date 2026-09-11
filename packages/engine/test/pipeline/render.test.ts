import { test, expect, describe } from "bun:test";
import { renderStage } from "../../src/pipeline/render.ts";
import { createPipelineKernel } from "./test-kernel.ts";

async function collectRender(
  gen: AsyncGenerator<import("../../src/pipeline/types.ts").RenderPart, import("../../src/pipeline/types.ts").RenderResult>,
) {
  const parts: import("../../src/pipeline/types.ts").RenderPart[] = [];
  let result: import("../../src/pipeline/types.ts").RenderResult | undefined;
  while (true) {
    const n = await gen.next();
    if (n.done) {
      result = n.value;
      break;
    }
    parts.push(n.value);
  }
  return { parts, result: result! };
}

describe("renderStage", () => {
  test("streams text deltas and cue offsets", async () => {
    const { k } = createPipelineKernel({
      policy: {
        events: { types: { chat: { positive: true } } },
        cues: { types: { emote: { args: { who: { type: "string" } } } } },
        choices: { enabled: false, count: 3, filter: "true" },
        render: { retryOnMismatch: 0, recentTurns: 4 },
      },
      s1Handler: async function* () {
        yield { text: "Hel" };
        yield { text: "Hello", cues: [{ type: "emote", args: { who: "npc1" }, at: 5 }], intent_realized: "respond" };
      },
    });

    const turn = { turnId: "turn_0001", sceneId: "scn_0001", actor: "player", addressee: "npc1", speaker: "npc1", text: "x", autonomous: false };
    const { parts, result } = await collectRender(
      renderStage(k, turn, {
        tier: "s1",
        speaker: "npc1",
        addressee: "player",
        intent: { intent: "respond", scores: { respond: 1 } },
        appraisal: { type: "chat", intensity: 0.5, sincerity: 1, claims: [], search_terms: [], tags: [], input_class: "normal" },
        fieldEffects: {},
        scene: { id: "scn_0001", location: "loc", participants: ["player", "npc1"], turn: 1, firstTurn: false },
        history: [],
        sidenotes: [],
        hits: [],
      }),
    );

    const text = parts.filter((p) => p.type === "text").map((p) => (p.type === "text" ? p.text : "")).join("");
    expect(text).toBe("Hello");
    expect(parts.some((p) => p.type === "cue" && p.at === 5)).toBe(true);
    expect(result.mismatch).toBe(false);
  });

  test("choice filter drops and mismatch retry", async () => {
    const { k } = createPipelineKernel({
      policy: {
        events: { types: { chat: { positive: true } } },
        choices: { enabled: true, count: 2, filter: "choice.text != 'bad'" },
        render: { retryOnMismatch: 1, recentTurns: 4 },
      },
      s1Handler: (req) => {
        if (req.segments.dynamic?.includes("must realize")) {
          return {
            text: "ok",
            cues: [],
            intent_realized: "respond",
            choices: [
              { text: "bad", expected_event_type: "chat", tags: [] },
              { text: "good", expected_event_type: "chat", tags: [] },
            ],
          };
        }
        return { text: "wrong", cues: [], intent_realized: "other", choices: [{ text: "bad", expected_event_type: "chat", tags: [] }] };
      },
    });

    const turn = { turnId: "turn_0001", sceneId: "scn_0001", actor: "player", addressee: "npc1", speaker: "npc1", text: "x", autonomous: false };
    const { result, parts } = await collectRender(
      renderStage(k, turn, {
        tier: "s1",
        speaker: "npc1",
        addressee: "player",
        intent: { intent: "respond", scores: { respond: 1 } },
        appraisal: { type: "chat", intensity: 0.5, sincerity: 1, claims: [], search_terms: [], tags: [], input_class: "normal" },
        fieldEffects: {},
        scene: { id: "scn_0001", location: "loc", participants: ["player", "npc1"], turn: 1, firstTurn: false },
        history: [],
        sidenotes: [],
        hits: [],
      }),
    );

    expect(result.retried).toBe(true);
    expect(result.text).toBe("ok");
    expect(result.choices.length).toBe(1);
    expect(result.choiceDrafts.some((d) => d.kind === "choice.filtered")).toBe(true);
    expect(parts.filter((p) => p.type === "text").length).toBe(1);
  });

  test("drops invalid cues from result", async () => {
    const { k } = createPipelineKernel({
      policy: {
        events: { types: { chat: { positive: true } } },
        cues: { types: { emote: { args: { who: { type: "string" } } } } },
        choices: { enabled: false, count: 3, filter: "true" },
        render: { retryOnMismatch: 0, recentTurns: 4 },
      },
      s1Handler: async function* () {
        yield {
          text: "Hi",
          cues: [
            { type: "emote", args: { who: "npc1" }, at: 2 },
            { type: "unknown", args: {}, at: 0 },
            { type: "emote", args: {}, at: 99 },
          ],
          intent_realized: "respond",
        };
      },
    });

    const turn = { turnId: "turn_0001", sceneId: "scn_0001", actor: "player", addressee: "npc1", speaker: "npc1", text: "x", autonomous: false };
    const { result } = await collectRender(
      renderStage(k, turn, {
        tier: "s1",
        speaker: "npc1",
        addressee: "player",
        intent: { intent: "respond", scores: { respond: 1 } },
        appraisal: { type: "chat", intensity: 0.5, sincerity: 1, claims: [], search_terms: [], tags: [], input_class: "normal" },
        fieldEffects: {},
        scene: { id: "scn_0001", location: "loc", participants: ["player", "npc1"], turn: 1, firstTurn: false },
        history: [],
        sidenotes: [],
        hits: [],
      }),
    );

    expect(result.cues).toEqual([{ type: "emote", args: { who: "npc1" }, at: 2 }]);
  });

  test("uses streamed partial text when final structured text is empty", async () => {
    const { k } = createPipelineKernel({
      policy: {
        events: { types: { chat: { positive: true } } },
        cues: { types: {} },
        choices: { enabled: false, count: 3, filter: "true" },
        render: { retryOnMismatch: 0, recentTurns: 4 },
      },
      s1Handler: async function* () {
        yield { text: "Partial" };
        yield { text: "", cues: [], intent_realized: "respond" };
      },
    });

    const turn = { turnId: "turn_0001", sceneId: "scn_0001", actor: "player", addressee: "npc1", speaker: "npc1", text: "x", autonomous: false };
    const { result } = await collectRender(
      renderStage(k, turn, {
        tier: "s1",
        speaker: "npc1",
        addressee: "player",
        intent: { intent: "respond", scores: { respond: 1 } },
        appraisal: { type: "chat", intensity: 0.5, sincerity: 1, claims: [], search_terms: [], tags: [], input_class: "normal" },
        fieldEffects: {},
        scene: { id: "scn_0001", location: "loc", participants: ["player", "npc1"], turn: 1, firstTurn: false },
        history: [],
        sidenotes: [],
        hits: [],
      }),
    );

    expect(result.text).toBe("Partial");
  });
});
