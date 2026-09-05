import type { ModelMessage } from "ai";
import type { PromptSegments } from "../ports.ts";
import type { ModelSpec } from "../schema/authored.ts";

const EPHEMERAL_CACHE = {
  anthropic: { cacheControl: { type: "ephemeral" as const } },
};

function systemBlock(text: string, cache?: typeof EPHEMERAL_CACHE): ModelMessage | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  return { role: "system", content: trimmed, ...(cache ? { providerOptions: cache } : {}) };
}

/**
 * Maps §17.4 segments to model messages with provider-specific cache breakpoints.
 * Anthropic: `providerOptions.anthropic.cacheControl` on static (bp1) and semiStatic (bp2).
 * OpenAI / Google: stable prefix ordering (static → semiStatic → dynamic) for automatic prefix caching.
 */
export function segmentsToMessages(segments: PromptSegments, spec: Pick<ModelSpec, "provider">): ModelMessage[] {
  const messages: ModelMessage[] = [];
  const useAnthropicCache = spec.provider === "anthropic";

  const staticMsg = systemBlock(segments.static, useAnthropicCache ? EPHEMERAL_CACHE : undefined);
  if (staticMsg) messages.push(staticMsg);

  const semiMsg = systemBlock(segments.semiStatic, useAnthropicCache ? EPHEMERAL_CACHE : undefined);
  if (semiMsg) messages.push(semiMsg);

  const dynamicMsg = systemBlock(segments.dynamic);
  if (dynamicMsg) messages.push(dynamicMsg);

  for (const turn of segments.history ?? []) {
    messages.push({ role: turn.role, content: turn.content });
  }

  messages.push({ role: "user", content: segments.user });
  return messages;
}

/** Character count across all prompt segments (for Ollama num_ctx preflight). */
export function promptSegmentCharCount(segments: PromptSegments): number {
  let n = segments.static.length + segments.semiStatic.length + segments.dynamic.length + segments.user.length;
  for (const turn of segments.history ?? []) n += turn.content.length;
  return n;
}

/** Exposed for tests: cache markers on system messages (Anthropic only). */
export function anthropicCacheBreakpoints(messages: ModelMessage[]): number {
  let n = 0;
  for (const m of messages) {
    if (m.role !== "system") continue;
    const cc = m.providerOptions?.anthropic as { cacheControl?: unknown } | undefined;
    if (cc?.cacheControl) n++;
  }
  return n;
}
