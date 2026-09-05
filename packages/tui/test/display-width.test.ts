import { test, expect } from "bun:test";
import { displayWidth, truncateToWidth, wrapToWidth } from "../src/utils/display-width.ts";

test("displayWidth handles CJK", () => {
  expect(displayWidth("中文")).toBe(4);
  expect(displayWidth("a中")).toBe(3);
});

test("truncateToWidth respects grapheme boundaries", () => {
  expect(truncateToWidth("你好world", 5)).toBe("你好…");
});

test("wrapToWidth breaks on display columns", () => {
  const lines = wrapToWidth("abcd", 2);
  expect(lines).toEqual(["ab", "cd"]);
});
