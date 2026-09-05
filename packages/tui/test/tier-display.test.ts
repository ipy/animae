import { test, expect } from "bun:test";
import { formatTierLabel, formatTrackLabel, inferZhLanguage } from "../src/utils/tier-display.ts";

test("formatTierLabel uses zh-CN labels", () => {
  expect(formatTierLabel("accepting", "zh-CN")).toBe("认可");
  expect(formatTierLabel("accepting", "en")).toBe("accepting");
});

test("formatTrackLabel uses policy track labels in zh", () => {
  expect(formatTrackLabel("bond", "zh-CN")).toBe("羁绊");
});

test("inferZhLanguage detects Chinese chapter titles", () => {
  expect(inferZhLanguage("种子")).toBe(true);
  expect(inferZhLanguage("Prologue")).toBe(false);
});
