import { classifyModelError, isClassifiedModelErrorCode } from "../model/classify-error.ts";
import { AnimaeError } from "../types.ts";

export function rethrowPipelineModelError(
  err: unknown,
  fallbackCode: string,
  fallbackMessage: string,
  ctx?: { timeoutMs?: number; baseURL?: string },
): never {
  const classified = classifyModelError(err, ctx);
  if (classified) throw classified;
  if (err instanceof AnimaeError && isClassifiedModelErrorCode(err.code)) throw err;
  throw new AnimaeError(fallbackCode, fallbackMessage, err);
}
