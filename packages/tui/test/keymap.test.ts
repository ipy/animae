import { test, expect } from "bun:test";
import { choiceIndexFromKey, defaultKeymap, matchKeyAction } from "../src/keymap/default.ts";

test("matchKeyAction binds ctrl chords", () => {
  expect(matchKeyAction(defaultKeymap, "s", "s", { ctrl: true })).toBe("save");
  expect(matchKeyAction(defaultKeymap, "s", "s", { ctrl: false })).toBeUndefined();
  expect(matchKeyAction(defaultKeymap, "f1", "", { ctrl: false })).toBe("help");
  expect(matchKeyAction(defaultKeymap, "f6", "", { ctrl: false })).toBe("mode");
});

test("Alt+6 opens the mode panel where F-keys are media keys", () => {
  expect(matchKeyAction(defaultKeymap, "6", "6", { meta: true })).toBe("mode");
  // Without Alt the digit still picks choice 6.
  expect(matchKeyAction(defaultKeymap, "6", "6", {})).toBe("choicePick");
});

test("choiceIndexFromKey maps 1-9", () => {
  expect(choiceIndexFromKey("2", "")).toBe(1);
});

test("defaultKeymap matches documented default bindings", () => {
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
  expect(km.mode).toContain("f6");
  expect(km.save).toContain("s");
  expect(km.load).toContain("l");
  expect(km.rewindTurn).toContain("z");
  expect(km.closeOverlay).toContain("escape");
  expect(km.quit).toContain("c");
});
