import { test, expect } from "bun:test";
import { formatTierLabel, formatTrackLabel, inferZhLanguage } from "../src/utils/tier-display.ts";

test("formatTierLabel uses zh-CN labels", () => {
  expect(formatTierLabel("close", "zh-CN")).toBe("亲近");
  expect(formatTierLabel("accepting", "en")).toBe("accepting");
});

test("formatTrackLabel uses policy track labels in zh", () => {
  expect(formatTrackLabel("bond", "zh-CN")).toBe("bond");
});

test("inferZhLanguage detects Chinese chapter titles", () => {
  expect(inferZhLanguage("种子")).toBe(true);
  expect(inferZhLanguage("Prologue")).toBe(false);
});
