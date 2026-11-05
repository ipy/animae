import { expect, test } from "bun:test";
import {
  budgetSingleSection,
  estimateTokens,
  estimateTokensForText,
  segmentMetrics,
  truncateToCharBudget,
} from "../../src/pipeline/segment-utils.ts";

test("estimateTokensForText weights CJK higher than Latin", () => {
  expect(estimateTokensForText("hello world")).toBe(3);
  expect(estimateTokensForText("你好世界")).toBe(3);
  expect(estimateTokens(0)).toBe(0);
});

test("truncateToCharBudget and budgetSingleSection drop overflow", () => {
  const long = "word ".repeat(40);
  expect(truncateToCharBudget(long, 20).length).toBeLessThanOrEqual(20);
  const { text, dropped } = budgetSingleSection("body", long, 15);
  expect(text.length).toBeLessThanOrEqual(15);
  expect(dropped).toContain("body");
  expect(segmentMetrics("ab").tokensEst).toBeGreaterThan(0);
});
