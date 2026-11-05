import type { Kernel } from "../contracts.ts";
import { AnimaeError, type EventDraft } from "../types.ts";
import type { FallbackPhase } from "./types.ts";

/** Whether a failed LLM call of this phase is served by the rule backend (`runtime.fallbackOnError.<phase>`). */
export function fallbackEnabled(k: Kernel, phase: FallbackPhase): boolean {
  return k.runtime?.fallbackEnabled(phase) ?? false;
}

function isAbort(err: unknown): boolean {
  if (err instanceof Error && err.name === "AbortError") return true;
  return err instanceof AnimaeError && (err.code === "ABORTED" || err.code === "MODEL_ABORTED");
}

/**
 * A model failure the rule backend may stand in for. A replay miss is not one: it means the recording does not match
 * the run, and a cancelled call is the caller's decision, not a failure.
 */
export function isFallbackEligible(err: unknown): boolean {
  if (isAbort(err)) return false;
  return !(err instanceof AnimaeError && err.code === "RECORDING_MISSING");
}

export function describeFallbackError(err: unknown): { code: string; message: string } {
  if (err instanceof AnimaeError) return { code: err.code, message: err.message };
  if (err instanceof Error) return { code: err.name || "Error", message: err.message };
  return { code: "Error", message: String(err) };
}

/** The `runtime.fallback_used` event for an LLM call that the rule backend took over. */
export function fallbackDraft(phase: FallbackPhase, err: unknown, source: string): EventDraft {
  return {
    kind: "runtime.fallback_used",
    source,
    phase,
    from: "llm",
    to: "rule",
    error: describeFallbackError(err),
  };
}

/**
 * Runs `llm`; when it fails with an eligible error and the phase has fallback enabled, runs `rule` instead and hands the
 * `runtime.fallback_used` event to `onFallback` (default: append it to the timeline).
 */
export async function withRuleFallback<T>(
  k: Kernel,
  phase: FallbackPhase,
  source: string,
  llm: () => Promise<T>,
  rule: () => Promise<T> | T,
  onFallback?: (draft: EventDraft) => void | Promise<void>,
): Promise<{ value: T; backend: "llm" | "rule" }> {
  try {
    return { value: await llm(), backend: "llm" };
  } catch (err) {
    if (!fallbackEnabled(k, phase) || !isFallbackEligible(err)) throw err;
    const draft = fallbackDraft(phase, err, source);
    if (onFallback) await onFallback(draft);
    else await k.emit([draft]);
    return { value: await rule(), backend: "rule" };
  }
}
