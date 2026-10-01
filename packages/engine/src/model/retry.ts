import { APICallError, NoObjectGeneratedError, TypeValidationError } from "ai";
import { classifyModelError, isClassifiedModelErrorCode } from "./classify-error.ts";
import { AnimaeError } from "../types.ts";

const DEFAULT_MAX = 3;
const BASE_MS = 200;
/** A timed-out call is retried at most once (a second full wait is the most a user should be asked to sit through). */
export const MAX_TIMEOUT_RETRIES = 1;

export function isTimeoutLikeError(err: unknown): boolean {
  const classified = classifyModelError(err);
  if (classified?.code === "MODEL_TIMEOUT") return true;
  if (err instanceof AnimaeError && err.code === "MODEL_TIMEOUT") return true;
  if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) {
    return /timeout|timed out|first chunk|chunk/i.test(err.message);
  }
  return err instanceof Error && /timeout|timed out/i.test(err.message);
}

export function isTransientError(err: unknown): boolean {
  if (isTimeoutLikeError(err)) return true;
  // Errors already classified at the call site (streams): decide from the classification.
  if (err instanceof AnimaeError && isClassifiedModelErrorCode(err.code)) {
    if (err.code === "MODEL_UNREACHABLE") return true;
    if (err.code === "MODEL_HTTP") {
      const status = Number(err.params?.status);
      return status === 429 || status >= 500;
    }
    return false;
  }
  if (APICallError.isInstance(err)) {
    if (err.isRetryable) return true;
    const code = err.statusCode;
    if (code === 429) return true;
    if (code !== undefined && code >= 500) return true;
    if (code !== undefined && code >= 400 && code < 500) return false;
  }
  if (err instanceof TypeError && String(err.message).toLowerCase().includes("fetch")) return true;
  if (err instanceof Error && err.name === "AbortError") return false;
  return err instanceof Error && /network|timeout|econnreset|socket/i.test(err.message);
}

export function isOutputValidationError(err: unknown): boolean {
  if (NoObjectGeneratedError.isInstance(err)) return true;
  if (TypeValidationError.isInstance(err)) return true;
  return false;
}

export async function withTransientRetries<T>(
  fn: () => Promise<T>,
  opts?: { max?: number; sleep?: (ms: number) => Promise<void> },
): Promise<T> {
  const max = opts?.max ?? DEFAULT_MAX;
  const sleep = opts?.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  let last: unknown;
  let timeoutRetries = 0;
  for (let attempt = 0; attempt <= max; attempt++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (!isTransientError(e) || attempt >= max) throw e;
      if (isTimeoutLikeError(e)) {
        if (timeoutRetries >= MAX_TIMEOUT_RETRIES) throw e;
        timeoutRetries += 1;
      }
      const delay = BASE_MS * 2 ** attempt;
      await sleep(delay);
    }
  }
  throw last;
}
