/** Rough token estimate for CJK-heavy text (chars / 1.6). */
export function estimateTokens(chars: number): number {
  return Math.ceil(chars / 1.6);
}

const TRUNC_MARKER = "\n\n[…truncated to segment budget…]";

export function truncateToCharBudget(text: string, maxChars: number | undefined): string {
  if (!maxChars || text.length <= maxChars) return text;
  const keep = Math.max(0, maxChars - TRUNC_MARKER.length);
  return `${text.slice(0, keep).trimEnd()}${TRUNC_MARKER}`;
}

export function segmentMetrics(text: string): { chars: number; tokensEst: number } {
  const chars = text.length;
  return { chars, tokensEst: estimateTokens(chars) };
}
