import { describe, expect, test } from "bun:test";
import type { CharacterDef } from "../../src/schema/authored.ts";
import { buildPromptSegments, measurePromptSegments } from "../../src/pipeline/prompt.ts";
import { charDef, createPipelineKernel } from "./test-kernel.ts";

const scene = { id: "scn_0001", location: "loc", participants: ["player", "npc1"], turn: 1, firstTurn: false };

const input = (purpose: "render" | "appraise") => ({
  purpose,
  speaker: "npc1",
  addressee: "player",
  scene,
  history: [],
  fieldEffects: {},
  tier: "standard" as const,
  intent: { intent: "respond", scores: { respond: 1 } },
});

/** A character card that fills every section of the character sheet. */
function innkeeper(): CharacterDef {
  const base = charDef("npc1");
  return {
    ...base,
    persona: "Speaks plainly and never hurries.",
    card: {
      ...base.card,
      style: "Short sentences.",
      identity: { name: "Mira", summary: "a warm innkeeper", style_examples: ["Aye, sit down."] },
      constraints: {
        motives: ["keep the inn open", "protect the regulars"],
        bottom_lines: [
          { id: "b", text: "avoid idle gossip", tags: [], hardness: "soft" },
          { id: "a", text: "never betray a guest", tags: [], hardness: "hard" },
        ],
        taboos: ["crime"],
      },
    },
  };
}

function kernelWith(npc: CharacterDef, rulesText = "") {
  const { k } = createPipelineKernel({ chars: [npc, charDef("player")] });
  if (rulesText) Object.assign(k.authored.world, { rules_text: rulesText });
  return k;
}

describe("static prompt segment", () => {
  test("a render prompt carries the whole character sheet, then the world rules, then the output contract", () => {
    const { static: text } = buildPromptSegments(kernelWith(innkeeper(), "Magic is rare in this valley."), input("render"));
    const expectedOrder = [
      "Mira — a warm innkeeper",
      "Persona",
      "Speaks plainly and never hurries.",
      "Style\n\nShort sentences.",
      "Style examples\n\n- Aye, sit down.",
      "Motives\n\nkeep the inn open; protect the regulars",
      // hard limits are listed apart from soft ones, each sorted by its id
      "Hard limits\n\n- never betray a guest",
      "Soft limits\n\n- avoid idle gossip",
      "Taboos\n\ncrime",
      "World rules\n\nMagic is rare in this valley.",
      "Output contract (JSON only):",
    ];
    let at = -1;
    for (const part of expectedOrder) {
      const found = text.indexOf(part);
      expect(found, `"${part}" is missing or out of order`).toBeGreaterThan(at);
      at = found;
    }
  });

  test("a section the card leaves empty is left out rather than printed as an empty heading", () => {
    const bare = { ...charDef("npc1"), persona: "" };
    const { static: text } = buildPromptSegments(kernelWith(bare), input("render"));
    for (const heading of ["Persona", "Style\n", "Style examples", "Motives", "Soft limits", "World rules"]) {
      expect(text, heading).not.toContain(heading);
    }
    // charDef carries one hard bottom line and one taboo
    expect(text).toContain("Hard limits\n\n- no harm");
    expect(text).toContain("Taboos\n\ncrime");
  });

  test("an appraisal prompt does not carry the character sheet or the world rules", () => {
    const { static: text } = buildPromptSegments(kernelWith(innkeeper(), "Magic is rare in this valley."), input("appraise"));
    for (const secret of ["Speaks plainly", "Short sentences.", "keep the inn open", "never betray a guest", "Magic is rare"]) {
      expect(text, secret).not.toContain(secret);
    }
  });
});

describe("measurePromptSegments", () => {
  test("reports the size of each segment and counts the history as one", () => {
    const k = kernelWith(innkeeper());
    const segments = buildPromptSegments(k, input("render"));
    const sizes = measurePromptSegments({ ...segments, history: [{ role: "user", content: "abc" }, { role: "assistant", content: "defg" }] });
    expect(Object.keys(sizes).sort()).toEqual(["dynamic", "history", "semiStatic", "static", "user"]);
    expect(sizes.static!.chars).toBe(segments.static.length);
    expect(sizes.static!.tokensEst).toBeGreaterThan(0);
    expect(sizes.history!.chars).toBe("abc\ndefg".length);
    expect(measurePromptSegments({ ...segments, history: undefined }).history!.chars).toBe(0);
  });
});
