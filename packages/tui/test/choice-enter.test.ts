import { test, expect } from "bun:test";

/** Enter confirms highlighted choice when the choice menu is active (no input line focus). */
function enterConfirmsChoice(hasChoices: boolean, inputFocused: boolean): boolean {
  return hasChoices && !inputFocused;
}

test("Enter confirms choice when menu active", () => {
  expect(enterConfirmsChoice(true, false)).toBe(true);
  expect(enterConfirmsChoice(false, false)).toBe(false);
  expect(enterConfirmsChoice(true, true)).toBe(false);
});
