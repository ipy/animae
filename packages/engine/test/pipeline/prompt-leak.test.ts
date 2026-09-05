import { test, expect, describe } from "bun:test";
import { buildPromptSegments } from "../../src/pipeline/prompt.ts";
import { createPipelineKernel, charDef } from "./test-kernel.ts";

const LOCKED_NPC2 =
  "Classified institute log excerpt — must never appear in prompts when locked.";
const LOCKED_NPC1 = "brother-fate secret must not leak";
const UNLOCKED_LINE = "unlocked secret visible only to owner";

describe("prompt leak guards", () => {
  test("locked secrets of speaker never appear in any segment", () => {
    const { k, setState } = createPipelineKernel({
      chars: [
        { ...charDef("npc2"), secrets: [{ id: "s1", text: LOCKED_NPC2, tags: ["secret"], unlock: "false" }] },
        charDef("player"),
      ],
    });
    setState({
      ...k.timeline.state(),
      characters: {
        ...k.timeline.state().characters,
        npc2: { ...k.timeline.state().characters.npc2!, unlockedSecrets: [] },
      },
    });

    const seg = buildPromptSegments(k, {
      purpose: "render",
      speaker: "npc2",
      addressee: "player",
      scene: { id: "scn_0001", location: "loc", participants: ["player", "npc2"], turn: 2, firstTurn: false },
      history: [],
      fieldEffects: {},
      tier: "s1",
      intent: { intent: "respond", scores: { respond: 1 } },
    });
    const blob = [seg.static, seg.semiStatic, seg.dynamic, seg.user, ...(seg.history ?? []).map((h) => h.content)].join("\n");
    expect(blob).not.toContain(LOCKED_NPC2);
  });

  test("unlocked secrets appear in static only", () => {
    const { k, setState } = createPipelineKernel({
      chars: [{ ...charDef("npc1"), secrets: [{ id: "s1", text: UNLOCKED_LINE, tags: ["x"], unlock: "true" }] }],
    });
    setState({
      ...k.timeline.state(),
      characters: { ...k.timeline.state().characters, npc1: { ...k.timeline.state().characters.npc1!, unlockedSecrets: ["s1"] } },
    });
    const seg = buildPromptSegments(k, {
      purpose: "render",
      speaker: "npc1",
      addressee: "player",
      scene: { id: "scn_0001", location: "loc", participants: ["player", "npc1"], turn: 1, firstTurn: false },
      history: [],
      fieldEffects: {},
    });
    expect(seg.static).toContain(UNLOCKED_LINE);
    expect(seg.semiStatic).not.toContain(UNLOCKED_LINE);
    expect(seg.dynamic).not.toContain(UNLOCKED_LINE);
  });

  test("other characters secrets never appear in speaker prompt", () => {
    const { k } = createPipelineKernel({
      chars: [
        { ...charDef("npc1"), secrets: [{ id: "b1", text: LOCKED_NPC1, tags: ["secret"], unlock: "false" }] },
        { ...charDef("npc2"), secrets: [{ id: "c1", text: LOCKED_NPC2, tags: ["secret"], unlock: "false" }] },
        charDef("player"),
      ],
    });
    const seg = buildPromptSegments(k, {
      purpose: "appraise",
      speaker: "npc1",
      addressee: "player",
      scene: { id: "scn_0001", location: "loc", participants: ["player", "npc1", "npc2"], turn: 1, firstTurn: true },
      history: [],
      fieldEffects: {},
      actorText: "hello",
    });
    const blob = [seg.static, seg.semiStatic, seg.dynamic].join("\n");
    expect(blob).not.toContain(LOCKED_NPC2);
  });

  test("L4 hide/disguise/inject only in dynamic field effects", () => {
    const { k } = createPipelineKernel({ chars: [charDef("npc1"), charDef("player")] });
    const seg = buildPromptSegments(k, {
      purpose: "render",
      speaker: "npc1",
      addressee: "player",
      scene: { id: "scn_0001", location: "loc", participants: ["player", "npc1"], turn: 1, firstTurn: false },
      history: [],
      fieldEffects: {
        hide_entities: ["ghost-npc"],
        disguise: { player: "stranger" },
        inject_belief: [{ text: "I believe the gate is open.", tags: [], claims: [] }],
      },
      tier: "s1",
      intent: { intent: "respond", scores: { respond: 1 } },
    });
    expect(seg.dynamic).toContain("ghost-npc");
    expect(seg.dynamic).toContain("stranger");
    expect(seg.dynamic).toContain("gate is open");
    expect(seg.static).not.toContain("ghost-npc");
  });
});
