import { test, expect } from "bun:test";
import { cueVisibleAt } from "../src/cues/registry.ts";

test("cueVisibleAt aligns to typewriter progress", () => {
  expect(cueVisibleAt(3, 2)).toBe(false);
  expect(cueVisibleAt(3, 4)).toBe(true);
});
