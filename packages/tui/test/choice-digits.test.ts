import { test, expect } from "bun:test";

/** Mirrors TuiShell: digit picks apply only when input draft is empty and focus is not input. */
function digitsPickChoices(inputDraft: string, focus: string): boolean {
  return inputDraft.length === 0 && focus !== "input";
}

test("choice digits inactive while typing in input", () => {
  expect(digitsPickChoices("1", "input")).toBe(false);
  expect(digitsPickChoices("", "input")).toBe(false);
  expect(digitsPickChoices("", "choices")).toBe(true);
  expect(digitsPickChoices("", "transcript")).toBe(true);
});
