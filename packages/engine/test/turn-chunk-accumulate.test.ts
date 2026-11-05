import { describe, expect, test } from "bun:test";
import {
  applyNarrationTurnChunk,
  applyTextTurnChunk,
  createParagraphStreamState,
  createUtteranceStreamState,
  isActorEcho,
} from "../src/turn-chunk-accumulate.ts";

describe("applyTextTurnChunk", () => {
  test("appends same-speaker fragments", () => {
    let s = createUtteranceStreamState();
    const a = applyTextTurnChunk(s, { type: "text", text: "\u65e9", speaker: "npc", newUtterance: true });
    s = a.state;
    expect(a.newUtterance).toBe(true);
    expect(a.delta).toBe("\u65e9");
    const b = applyTextTurnChunk(s, { type: "text", text: "\u5b89", speaker: "npc" });
    expect(b.newUtterance).toBe(false);
    expect(b.delta).toBe("\u5b89");
    expect(b.state.text).toBe("\u65e9\u5b89");
  });

  test("splits on speaker change and newUtterance", () => {
    let s = createUtteranceStreamState();
    s = applyTextTurnChunk(s, { type: "text", text: "A", speaker: "a", newUtterance: true }).state;
    const b = applyTextTurnChunk(s, { type: "text", text: "B", speaker: "b", newUtterance: true });
    expect(b.completePrior).toBe(true);
    expect(b.newUtterance).toBe(true);
    expect(b.state.text).toBe("B");
  });

  test("allows empty fragment append", () => {
    let s = createUtteranceStreamState();
    s = applyTextTurnChunk(s, { type: "text", text: "x", speaker: "n", newUtterance: true }).state;
    const b = applyTextTurnChunk(s, { type: "text", text: "", speaker: "n" });
    expect(b.delta).toBe("");
    expect(b.state.text).toBe("x");
  });
});

describe("applyNarrationTurnChunk", () => {
  test("a first fragment opens a paragraph; later fragments append to it", () => {
    let s = createParagraphStreamState();
    const a = applyNarrationTurnChunk(s, { type: "narration", text: "The rain ", newParagraph: true });
    s = a.state;
    expect(a.newParagraph).toBe(true);
    expect(a.completePrior).toBe(false);
    expect(a.state.style).toBe("normal");
    const b = applyNarrationTurnChunk(s, { type: "narration", text: "keeps falling." });
    expect(b.newParagraph).toBe(false);
    expect(b.delta).toBe("keeps falling.");
    expect(b.state.text).toBe("The rain keeps falling.");
  });

  test("a chunk without newParagraph still opens one when none is open", () => {
    const a = applyNarrationTurnChunk(createParagraphStreamState(), { type: "narration", text: "Dusk." });
    expect(a.newParagraph).toBe(true);
    expect(a.state.open).toBe(true);
  });

  test("newParagraph closes the open paragraph and starts another", () => {
    let s = applyNarrationTurnChunk(createParagraphStreamState(), { type: "narration", text: "One." }).state;
    const b = applyNarrationTurnChunk(s, { type: "narration", text: "Two.", newParagraph: true });
    expect(b.completePrior).toBe(true);
    expect(b.newParagraph).toBe(true);
    expect(b.state.text).toBe("Two.");
  });

  test("a scene break never merges into a normal paragraph", () => {
    const s = applyNarrationTurnChunk(createParagraphStreamState(), { type: "narration", text: "Evening." }).state;
    const b = applyNarrationTurnChunk(s, { type: "narration", text: "Later.", style: "scene_break" });
    expect(b.completePrior).toBe(true);
    expect(b.newParagraph).toBe(true);
    expect(b.state.style).toBe("scene_break");
  });
});

describe("isActorEcho", () => {
  test("only the acting character's own non-autonomous text counts", () => {
    expect(isActorEcho({ type: "text", text: "hi", speaker: "player", newUtterance: true }, "player")).toBe(true);
    expect(isActorEcho({ type: "text", text: "hello", speaker: "npc" }, "player")).toBe(false);
    expect(isActorEcho({ type: "text", text: "hm", speaker: "player", autonomous: true }, "player")).toBe(false);
    expect(isActorEcho({ type: "narration", text: "x" }, "player")).toBe(false);
    expect(isActorEcho({ type: "text", text: "hi", speaker: "player" }, undefined)).toBe(false);
  });
});
