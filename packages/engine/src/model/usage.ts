import type { LanguageModelUsage } from "ai";
import type { Usage } from "../types.ts";

export function mapUsage(u: LanguageModelUsage | undefined): Usage {
  if (!u) return { inputTokens: 0, outputTokens: 0 };
  return {
    inputTokens: u.inputTokens ?? 0,
    outputTokens: u.outputTokens ?? 0,
    cachedInputTokens: u.inputTokenDetails?.cacheReadTokens,
  };
}

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cachedInputTokens: (a.cachedInputTokens ?? 0) + (b.cachedInputTokens ?? 0) || undefined,
  };
}

export class UsageTracker {
  private total: Usage = { inputTokens: 0, outputTokens: 0 };

  add(u: Usage): void {
    this.total = addUsage(this.total, u);
  }

  snapshot(): Usage {
    return { ...this.total, ...(this.total.cachedInputTokens !== undefined ? { cachedInputTokens: this.total.cachedInputTokens } : {}) };
  }
}
