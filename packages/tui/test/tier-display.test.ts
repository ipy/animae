import { test, expect } from "bun:test";
import { formatTierLabel, formatTrackLabel } from "../src/utils/tier-display.ts";

test("formatTierLabel uses zh-CN labels", () => {
  expect(formatTierLabel("close", "zh-CN")).toBe("亲近");
  expect(formatTierLabel("accepting", "en")).toBe("accepting");
});

test("formatTrackLabel uses catalog when present", () => {
  expect(formatTrackLabel("bond", "zh-CN")).toBe("羁绊");
  expect(formatTrackLabel("unknown_track", "en")).toBe("unknown_track");
});
