import { test, expect } from "bun:test";

/** Mirrors DefaultLayout: input chrome active when focused, even if choices are on screen. */
function inputActive(focus: string, overlay: string | undefined, _hasChoices: boolean): boolean {
  return focus === "input" && !overlay;
}

test("input line active with choices when focus is input", () => {
  expect(inputActive("input", undefined, true)).toBe(true);
  expect(inputActive("transcript", undefined, true)).toBe(false);
  expect(inputActive("input", "help", true)).toBe(false);
});
