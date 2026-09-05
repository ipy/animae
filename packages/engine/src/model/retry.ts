import { APICallError, NoObjectGeneratedError, TypeValidationError } from "ai";

const DEFAULT_MAX = 3;
const BASE_MS = 200;

export function isTransientError(err: unknown): boolean {
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
  for (let attempt = 0; attempt <= max; attempt++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (!isTransientError(e) || attempt >= max) throw e;
      const delay = BASE_MS * 2 ** attempt;
      await sleep(delay);
    }
  }
  throw last;
}
