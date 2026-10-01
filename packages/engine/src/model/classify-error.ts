import { APICallError, JSONParseError, NoObjectGeneratedError, RetryError, TypeValidationError } from "ai";
import { AnimaeError, type JsonValue } from "../types.ts";

export type ModelTimeoutPhase = "connect" | "first_chunk" | "idle" | "total";

const MODEL_ERROR_CODES = new Set([
  "MODEL_TIMEOUT",
  "MODEL_UNREACHABLE",
  "MODEL_HTTP",
  "MODEL_EMPTY",
  "MODEL_OUTPUT_INVALID",
]);

export function isClassifiedModelErrorCode(code: string): boolean {
  return MODEL_ERROR_CODES.has(code);
}

function walkErrorChain(err: unknown): unknown[] {
  const out: unknown[] = [];
  const seen = new Set<unknown>();
  let cur: unknown = err;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    out.push(cur);
    if (cur instanceof AnimaeError && cur.details !== undefined) {
      cur = cur.details;
      continue;
    }
    if (cur instanceof Error && "cause" in cur && cur.cause !== undefined) {
      cur = cur.cause;
      continue;
    }
    break;
  }
  return out;
}

function errnoCode(err: unknown): string | undefined {
  if (!err || typeof err !== "object") return undefined;
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

export function sanitizeHttpDetail(body: unknown): string | undefined {
  if (body === undefined || body === null) return undefined;
  let text: string;
  if (typeof body === "string") text = body;
  else {
    try {
      text = JSON.stringify(body);
    } catch {
      text = String(body);
    }
  }
  const stripped = text.replace(/\s+/g, " ").trim();
  if (!stripped) return undefined;
  const noAuth = stripped.replace(/Bearer\s+\S+/gi, "[redacted]").replace(/sk-[A-Za-z0-9_-]{8,}/g, "[redacted]");
  return noAuth.length > 200 ? `${noAuth.slice(0, 197)}...` : noAuth;
}

function hostFromUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
}

function hostFromMessage(msg: string): string | undefined {
  const m = msg.match(/https?:\/\/([^/\s]+)/i);
  return m?.[1];
}

function inferTimeoutPhase(err: unknown, message: string): ModelTimeoutPhase {
  const lower = message.toLowerCase();
  if (/first chunk|firstchunk|first content/i.test(lower)) return "first_chunk";
  if (/chunk|idle|between/i.test(lower)) return "idle";
  if (/abort|timed out|timeout/i.test(lower) && errnoCode(err) === "ECONNABORTED") return "connect";
  if (/timed out|timeout/i.test(lower)) return "total";
  return "total";
}

/** Output-shape errors quote the model's own text, so words like "timeout" in them say nothing about transport. */
function isOutputShapeError(err: unknown): boolean {
  return NoObjectGeneratedError.isInstance(err) || TypeValidationError.isInstance(err) || JSONParseError.isInstance(err);
}

function isAbortOrTimeout(err: unknown): boolean {
  if (isOutputShapeError(err)) return false;
  if (err instanceof DOMException && err.name === "TimeoutError") return true;
  if (err instanceof Error) {
    if (err.name === "AbortError" || err.name === "TimeoutError") return true;
    if (/timeout|timed out|aborted|abort/i.test(err.message)) return true;
  }
  return false;
}

/** Node errno codes plus the codes and wording Bun's `fetch` uses for a refused/dropped/unresolvable connection. */
const UNREACHABLE_CODES = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ConnectionRefused",
  "ConnectionClosed",
  "FailedToOpenSocket",
]);

const UNREACHABLE_MESSAGE_RE =
  /ECONNREFUSED|ENOTFOUND|getaddrinfo|fetch failed|Unable to connect|Cannot connect to API|typo in the url or port|socket connection was closed/i;

function isUnreachable(err: unknown, message: string): boolean {
  const code = errnoCode(err);
  if (code !== undefined && UNREACHABLE_CODES.has(code)) return true;
  if (err instanceof TypeError && /fetch failed/i.test(message)) return true;
  return UNREACHABLE_MESSAGE_RE.test(message);
}

/** The classified error for a request that produced no (further) output within the configured limit. */
export function modelTimeoutError(timeoutMs: number, phase: ModelTimeoutPhase, cause?: unknown): AnimaeError {
  const seconds = Math.max(1, Math.round(timeoutMs / 1000));
  return new AnimaeError("MODEL_TIMEOUT", "Model request timed out", cause, {
    params: { timeoutMs, seconds, phase },
  });
}

export function classifyModelError(
  err: unknown,
  ctx?: { timeoutMs?: number; baseURL?: string },
): AnimaeError | undefined {
  if (err instanceof AnimaeError && isClassifiedModelErrorCode(err.code)) return err;

  for (const node of walkErrorChain(err)) {
    if (node instanceof AnimaeError && isClassifiedModelErrorCode(node.code)) return node;

    if (APICallError.isInstance(node)) {
      const status = node.statusCode;
      const host =
        hostFromUrl(node.url) ??
        hostFromMessage(node.message) ??
        hostFromUrl(ctx?.baseURL) ??
        "unknown";
      if (status !== undefined) {
        const detail = sanitizeHttpDetail(node.responseBody ?? node.message);
        const params: Record<string, JsonValue> = { status };
        if (detail) params.detail = detail;
        return new AnimaeError("MODEL_HTTP", `Model HTTP error ${status}`, node, { params });
      }
    }

    if (RetryError.isInstance(node)) {
      const inner = node.lastError ?? node.errors?.at(-1);
      if (inner) {
        const nested = classifyModelError(inner, ctx);
        if (nested) return nested;
      }
    }

    const message = node instanceof Error ? node.message : String(node);
    if (isAbortOrTimeout(node)) {
      return modelTimeoutError(ctx?.timeoutMs ?? 0, inferTimeoutPhase(node, message), node);
    }

    if (isUnreachable(node, message)) {
      const host =
        hostFromUrl(ctx?.baseURL) ??
        hostFromMessage(message) ??
        "unknown";
      return new AnimaeError("MODEL_UNREACHABLE", "Model endpoint unreachable", node, {
        params: { host },
      });
    }
  }

  return undefined;
}

export function asModelAnimaeError(
  err: unknown,
  ctx?: { timeoutMs?: number; baseURL?: string },
): AnimaeError {
  const classified = classifyModelError(err, ctx);
  if (classified) return classified;
  if (err instanceof AnimaeError) return err;
  return new AnimaeError("MODEL_FAILED", err instanceof Error ? err.message : String(err), err);
}
