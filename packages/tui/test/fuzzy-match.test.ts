import { expect, test } from "bun:test";
import { fuzzyRank, fuzzyScore } from "../src/utils/fuzzy-match.ts";

test("fuzzyScore subsequence and substring", () => {
  expect(fuzzyScore("help", ":help")).toBeDefined();
  expect(fuzzyScore("xyz", "abc")).toBeUndefined();
});

test("fuzzyRank orders better matches first", () => {
  const items = ["assign", "status", "achievements"];
  const ranked = fuzzyRank("ach", items, (x) => x);
  expect(ranked[0]).toBe("achievements");
});
