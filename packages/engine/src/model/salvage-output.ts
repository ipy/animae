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

function tryParseStructured(trimmed: string): unknown | undefined {
  try {
    return parseJsonLoose(trimmed);
  } catch {
    /* fall through */
  }
  const slice = extractJsonObjectFromText(trimmed);
  if (!slice) return undefined;
  try {
    return JSON.parse(slice) as unknown;
  } catch {
    return undefined;
  }
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
    const ok = schema.safeParse(parsed);
    if (ok.success) return ok.data;
  }

  if (!trimmed.includes("{")) {
    const wrapped = { text: trimmed, cues: [], intent_realized: "" };
    const ok = schema.safeParse(wrapped);
    if (ok.success) return ok.data;
  }
  return undefined;
}
