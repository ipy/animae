import { test, expect } from "bun:test";
import { choiceIndexFromKey, defaultKeymap, matchKeyAction } from "../src/keymap/default.ts";

test("matchKeyAction binds ctrl chords", () => {
  expect(matchKeyAction(defaultKeymap, "s", "s", { ctrl: true })).toBe("save");
  expect(matchKeyAction(defaultKeymap, "f1", "", { ctrl: false })).toBe("help");
});

test("choiceIndexFromKey maps 1-9", () => {
  expect(choiceIndexFromKey("2", "")).toBe(1);
});

test("defaultKeymap matches spec §21.3 bindings", () => {
  const km = defaultKeymap;
  expect(km.submit).toContain("return");
  expect(km.choiceUp).toContain("up");
  expect(km.choiceDown).toContain("down");
  expect(km.choicePick.length).toBe(9);
  expect(km.skipTypewriter).toContain("*");
  expect(km.focusNext).toContain("tab");
  expect(km.help).toContain("f1");
  expect(km.eventLog).toContain("f2");
  expect(km.timeline).toContain("f3");
  expect(km.explain).toContain("f4");
  expect(km.inspector).toContain("f5");
  expect(km.save).toContain("s");
  expect(km.load).toContain("l");
  expect(km.rewindTurn).toContain("z");
  expect(km.closeOverlay).toContain("escape");
  expect(km.quit).toContain("c");
});
