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

const TRUNC_MARKER = "\n\n[…truncated to segment budget…]";

export function truncateToCharBudget(text: string, maxChars: number | undefined): string {
  if (!maxChars || text.length <= maxChars) return text;
  const keep = Math.max(0, maxChars - TRUNC_MARKER.length);
  return `${text.slice(0, keep).trimEnd()}${TRUNC_MARKER}`;
}

export function segmentMetrics(text: string): { chars: number; tokensEst: number } {
  const chars = text.length;
  return { chars, tokensEst: estimateTokensForText(text) };
}
