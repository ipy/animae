const THINK_TAG = /<\s*think\s*>[\s\S]*?<\s*\/\s*think\s*>/gi;
const REDACTED_THINKING = /<\s*redacted_thinking\s*>[\s\S]*?<\s*\/\s*redacted_thinking\s*>/gi;

/** Remove common reasoning / thinking blocks from model text (structured fields). */
export function stripThinkingArtifacts(text: string): string {
  let out = text;
  out = out.replace(THINK_TAG, "");
  out = out.replace(REDACTED_THINKING, "");
  return out.trim();
}

/** Strip thinking artifacts from known string fields on structured outputs. */
export function sanitizeStructuredOutput<T>(value: T): T {
  if (value == null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((v) => sanitizeStructuredOutput(v)) as T;
  }
  const rec = value as Record<string, unknown>;
  const out: Record<string, unknown> = { ...rec };
  for (const [k, v] of Object.entries(out)) {
    if (typeof v === "string" && (k === "text" || k === "content" || k === "reasoning_content")) {
      if (k === "reasoning_content") {
        delete out[k];
        continue;
      }
      out[k] = stripThinkingArtifacts(v);
    } else if (v != null && typeof v === "object") {
      out[k] = sanitizeStructuredOutput(v);
    }
  }
  return out as T;
}
