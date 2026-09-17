import { NoObjectGeneratedError } from "ai";
import type { ZodType } from "zod";
import { parseJsonLoose } from "../pipeline/coerce.ts";
import { extractJsonObjectFromText } from "./reasoning-fetch.ts";
import { stripThinkingArtifacts } from "./reasoning.ts";

function rawTextFromValidationError(err: unknown): string | undefined {
  if (NoObjectGeneratedError.isInstance(err)) {
    const t = err.text;
    if (typeof t === "string" && t.trim()) return t;
  }
  if (err && typeof err === "object" && "cause" in err) {
    return rawTextFromValidationError((err as { cause?: unknown }).cause);
  }
  return undefined;
}

const DANGLING_KEY_AFTER_OPEN_OR_COMMA = /([{,])\s*"(?:[^"\\]|\\.)*"\s*$/;
const KEY_WITHOUT_VALUE = /"(?:[^"\\]|\\.)*"\s*:\s*$/;

/**
 * Best-effort repair of JSON text that a model cut off (token limit) or wrote with raw control characters inside
 * strings, both of which `JSON.parse` rejects as "Unterminated string": escapes control characters inside strings,
 * closes an unterminated string, drops a dangling key / comma and closes the open containers. The result is only a
 * candidate; callers must still validate it against their schema.
 */
export function repairJsonText(raw: string): { json: string; truncated: boolean } | undefined {
  const start = raw.indexOf("{");
  if (start < 0) return undefined;
  const stack: ("{" | "[")[] = [];
  let out = "";
  let inString = false;
  let escape = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i]!;
    if (inString) {
      if (escape) {
        out += ch;
        escape = false;
      } else if (ch === "\\") {
        out += ch;
        escape = true;
      } else if (ch === '"') {
        out += ch;
        inString = false;
      } else if (ch.charCodeAt(0) < 0x20) {
        const code = ch.charCodeAt(0);
        out += ch === "\n" ? "\\n" : ch === "\r" ? "\\r" : ch === "\t" ? "\\t" : `\\u${code.toString(16).padStart(4, "0")}`;
      } else {
        out += ch;
      }
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") stack.push(ch);
    else if (ch === "}" || ch === "]") stack.pop();
    out += ch;
    if (stack.length === 0 && (ch === "}" || ch === "]")) return { json: out, truncated: false };
  }

  // Cut off mid-way: finish the string, drop what cannot be completed, close the containers.
  if (escape) out = out.slice(0, -1);
  if (inString) out += '"';
  for (let guard = 0; guard < 4; guard++) {
    const before = out;
    out = out.replace(/,\s*$/, "");
    if (stack[stack.length - 1] === "{") out = out.replace(DANGLING_KEY_AFTER_OPEN_OR_COMMA, "$1");
    out = out.replace(KEY_WITHOUT_VALUE, "");
    if (out === before) break;
  }
  out = out.replace(/,\s*$/, "");
  while (stack.length) out += stack.pop() === "{" ? "}" : "]";
  return { json: out, truncated: true };
}

function tryParseStructured(trimmed: string): { value: unknown; truncated: boolean } | undefined {
  try {
    return { value: parseJsonLoose(trimmed), truncated: false };
  } catch {
    /* fall through */
  }
  const slice = extractJsonObjectFromText(trimmed);
  if (slice) {
    try {
      return { value: JSON.parse(slice) as unknown, truncated: false };
    } catch {
      /* fall through to repair */
    }
  }
  const repaired = repairJsonText(trimmed);
  if (!repaired) return undefined;
  try {
    return { value: JSON.parse(repaired.json) as unknown, truncated: repaired.truncated };
  } catch {
    return undefined;
  }
}

/** A reply object reduced to what a cut-off response can still carry: its text, without half-written siblings. */
function textOnlyCandidate(parsed: unknown): Record<string, unknown> | undefined {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const text = (parsed as { text?: unknown }).text;
  if (typeof text !== "string" || !text.trim()) return undefined;
  return { text, cues: [], intent_realized: "" };
}

/**
 * When a gateway returns dialogue prose instead of JSON, recover a minimal object if the schema accepts it.
 * Used after repair hints fail (common on openai-compatible hosts with weak structured-output support).
 */
export function salvageStructuredFromValidationError<T>(
  err: unknown,
  schema: ZodType<T>,
): T | undefined {
  const raw = rawTextFromValidationError(err);
  if (!raw) return undefined;
  const trimmed = stripThinkingArtifacts(raw.trim());
  if (!trimmed) return undefined;

  const parsed = tryParseStructured(trimmed);
  if (parsed !== undefined) {
    // A reply that was cut off keeps only the part the player reads (its text): half-written cues / choices are
    // dropped, and a cut-off reply without any text is not a reply at all.
    const candidate = parsed.truncated ? textOnlyCandidate(parsed.value) : parsed.value;
    if (candidate !== undefined) {
      const ok = schema.safeParse(candidate);
      if (ok.success) return ok.data;
    }
    if (!parsed.truncated) {
      const textOnly = textOnlyCandidate(parsed.value);
      if (textOnly) {
        const ok = schema.safeParse(textOnly);
        if (ok.success) return ok.data;
      }
    }
  }

  if (!trimmed.includes("{")) {
    const wrapped = { text: trimmed, cues: [], intent_realized: "" };
    const ok = schema.safeParse(wrapped);
    if (ok.success) return ok.data;
  }
  return undefined;
}
