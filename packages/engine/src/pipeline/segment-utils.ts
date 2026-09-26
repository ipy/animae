const CJK_RE = /[\u3000-\u9fff\uff00-\uffef]/;

/** Rough token estimate: Latin ~4 chars/token, CJK ~1.6 chars/token. */
export function estimateTokens(chars: number): number {
  return Math.ceil(chars / 1.6);
}

export function estimateTokensForText(text: string): number {
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    if (CJK_RE.test(ch)) cjk++;
    else other++;
  }
  return Math.ceil(cjk / 1.6 + other / 4);
}

import { assembleBudgetSections, type BudgetSection } from "./section-budget.ts";

/** @deprecated Prefer section-aware {@link assembleBudgetSections}; kept for callers that pass one blob. */
export function truncateToCharBudget(text: string, maxChars: number | undefined): string {
  if (!maxChars || text.length <= maxChars) return text;
  return assembleBudgetSections([{ id: "body", priority: 0, text }], maxChars).text;
}

export function budgetSingleSection(id: string, text: string, maxChars: number | undefined): { text: string; dropped: string[] } {
  return assembleBudgetSections([{ id, priority: 0, text }], maxChars);
}

export type { BudgetSection };
export { assembleBudgetSections };

export function segmentMetrics(text: string): { chars: number; tokensEst: number } {
  const chars = text.length;
  return { chars, tokensEst: estimateTokensForText(text) };
}
