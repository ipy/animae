import { describe, expect, test } from "bun:test";
import { applyTextTurnChunk, createUtteranceStreamState } from "../src/turn-chunk-accumulate.ts";

describe("applyTextTurnChunk", () => {
  test("appends same-speaker fragments", () => {
    let s = createUtteranceStreamState();
    const a = applyTextTurnChunk(s, { type: "text", text: "早", speaker: "npc", newUtterance: true });
    s = a.state;
    expect(a.newUtterance).toBe(true);
    expect(a.delta).toBe("早");
    const b = applyTextTurnChunk(s, { type: "text", text: "安", speaker: "npc" });
    expect(b.newUtterance).toBe(false);
    expect(b.delta).toBe("安");
    expect(b.state.text).toBe("早安");
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
