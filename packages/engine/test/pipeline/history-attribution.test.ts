import { describe, expect, test } from "bun:test";
import { historyToMessages, type HistoryMessage } from "../../src/pipeline/history.ts";
import { buildPromptSegments } from "../../src/pipeline/prompt.ts";
import type { TurnHistoryLine } from "../../src/pipeline/types.ts";
import { charDef, createPipelineKernel } from "./test-kernel.ts";

const NAMES: Record<string, string> = { player: "Gu Yuan", npc1: "Bai Zhi", npc2: "Cen Wu" };
const attribution = (speaker: string) => ({ speaker, nameOf: (id: string) => NAMES[id] ?? id });

const line = (role: "user" | "assistant", speaker: string, content: string, turnId = "turn_0001"): TurnHistoryLine => ({
  turnId,
  role,
  speaker,
  content,
});

describe("history attribution", () => {
  test("one speaking character: lines map one to one, nothing is prefixed", () => {
    const history = [line("user", "player", "hi"), line("assistant", "npc1", "hello"), line("user", "player", "how are you")];
    const expected: HistoryMessage[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
      { role: "user", content: "how are you" },
    ];
    expect(historyToMessages(history, attribution("npc1"))).toEqual(expected);
    expect(historyToMessages(history)).toEqual(expected);
  });

  test("another character's reply is not presented as the speaker's own earlier words", () => {
    const history = [
      line("user", "player", "good morning, everyone"),
      line("assistant", "npc1", "The seedlings are fine."),
      line("user", "player", "and you?", "turn_0002"),
    ];
    // Cen Wu answers next: Bai Zhi's reply must reach the model as someone else's line.
    expect(historyToMessages(history, attribution("npc2"))).toEqual([
      { role: "user", content: "Gu Yuan: good morning, everyone" },
      { role: "user", content: "Bai Zhi: The seedlings are fine." },
      { role: "user", content: "Gu Yuan: and you?" },
    ]);
  });

  test("the speaker's own replies stay assistant messages once other voices are present", () => {
    const history = [
      line("user", "player", "hi"),
      line("assistant", "npc1", "Morning."),
      line("assistant", "npc2", "Hm."),
      line("user", "player", "tell me more", "turn_0002"),
    ];
    expect(historyToMessages(history, attribution("npc1"))).toEqual([
      { role: "user", content: "Gu Yuan: hi" },
      { role: "assistant", content: "Morning." },
      { role: "user", content: "Cen Wu: Hm." },
      { role: "user", content: "Gu Yuan: tell me more" },
    ]);
  });

  test("lines without a speaker count as the current speaker's own", () => {
    const history: TurnHistoryLine[] = [{ role: "assistant", content: "narration" }];
    expect(historyToMessages(history, attribution("npc1"))).toEqual([{ role: "assistant", content: "narration" }]);
  });
});

describe("render prompt names the speaker", () => {
  const scene = { id: "scn_0001", location: "loc", participants: ["player", "npc1", "npc2"], turn: 1, firstTurn: false };
  const base = {
    purpose: "render" as const,
    addressee: "player",
    scene,
    fieldEffects: {},
    tier: "s1" as const,
    intent: { intent: "respond", scores: { respond: 1 } },
  };

  test("the closing user message says who speaks, and history is attributed in a multi-character scene", () => {
    const { k } = createPipelineKernel({ chars: [charDef("npc1"), charDef("npc2"), charDef("player")] });
    const seg = buildPromptSegments(k, {
      ...base,
      speaker: "npc2",
      history: [line("user", "player", "hello all"), line("assistant", "npc1", "Hi!")],
    });
    expect(seg.user).toContain("Generate npc2's in-character response");
    expect(seg.user).toContain("Speak only as npc2");
    expect(seg.history).toEqual([
      { role: "user", content: "player: hello all" },
      { role: "user", content: "npc1: Hi!" },
    ]);
  });
});
