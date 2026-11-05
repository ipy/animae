import { describe, expect, test } from "bun:test";
import type { FieldEffects } from "../../src/schema/authored.ts";
import { buildPromptSegments } from "../../src/pipeline/prompt.ts";
import { charDef, createPipelineKernel } from "./test-kernel.ts";

const scene = { id: "scn_0001", location: "loc", participants: ["player", "npc1"], turn: 1, firstTurn: false };

function dynamicFor(fieldEffects: FieldEffects): string {
  const { k } = createPipelineKernel({ chars: [charDef("npc1"), charDef("player")] });
  return buildPromptSegments(k, {
    purpose: "render",
    speaker: "npc1",
    addressee: "player",
    scene,
    history: [],
    fieldEffects,
    tier: "standard",
    intent: { intent: "respond", scores: { respond: 1 } },
  }).dynamic;
}

describe("field effects in the dynamic prompt segment", () => {
  test("every prompt-side effect is stated on a line of its own, with its keys in a stable order", () => {
    const dynamic = dynamicFor({
      topic_access: { close: ["war", "debts"], open: ["weather"] },
      salience: [
        { tags: ["secret", "past"], boost: 2 },
        { tags: ["rumor"], boost: -1 },
      ],
      event_prob: { flirt: 0.2, betray: 0.05 },
      world_vars: { season: "winter", gold: 3 },
      intent_force: "flee",
      intent_forbid: ["attack", "taunt"],
      intent_bias: { comfort: 2 },
      hide_entities: ["player"],
      disguise: { player: "the stranger" },
      inject_belief: [{ text: "The well is poisoned.", tags: [], claims: [] }],
    });
    const wanted = [
      "Topics closed: debts, war",
      "Topics open: weather",
      "Salience boosts: secret+past:2; rumor:-1",
      "Event probability shifts: betray:0.05; flirt:0.2",
      'World context: gold=3, season="winter"',
      "Required intent: flee",
      "Forbidden intents: attack, taunt",
      'Intent bias: {"comfort":2}',
      "You do not perceive in this scene: player",
      'Names appear to you as: {"player":"the stranger"}',
      "Your beliefs (true for you):\n- The well is poisoned.",
    ];
    let at = -1;
    for (const line of wanted) {
      const found = dynamic.indexOf(line);
      expect(found, `"${line}" is missing or out of order`).toBeGreaterThan(at);
      at = found;
    }
  });

  test("an effect that is empty or absent leaves no line behind", () => {
    const dynamic = dynamicFor({
      topic_access: { close: [], open: [] },
      salience: [],
      event_prob: {},
      world_vars: {},
      intent_forbid: [],
      intent_bias: {},
      hide_entities: [],
      disguise: {},
      inject_belief: [],
    });
    for (const label of [
      "Topics closed",
      "Topics open",
      "Salience boosts",
      "Event probability shifts",
      "World context",
      "Required intent",
      "Forbidden intents",
      "Intent bias",
      "You do not perceive",
      "Names appear to you as",
      "Your beliefs",
    ]) {
      expect(dynamic, label).not.toContain(label);
    }
  });

  test("a hidden entity is listed by its display name, not its id", () => {
    const wanderer = { ...charDef("player"), card: { ...charDef("player").card, identity: { name: "Wanderer", summary: "", style_examples: [] } } };
    const { k } = createPipelineKernel({ chars: [charDef("npc1"), wanderer] });
    const dynamic = buildPromptSegments(k, {
      purpose: "render",
      speaker: "npc1",
      addressee: "player",
      scene,
      history: [],
      fieldEffects: { hide_entities: ["player"] },
      tier: "standard",
      intent: { intent: "respond", scores: { respond: 1 } },
    }).dynamic;
    expect(dynamic).toContain("You do not perceive in this scene: Wanderer");
  });
});
