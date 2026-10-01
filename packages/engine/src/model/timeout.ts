import type { ModelSpec } from "../schema/authored.ts";
import type { ModelTimeoutPhase } from "./classify-error.ts";

/** Upper bound for configured `ModelSpec.timeoutMs` (1 hour). */
export const MODEL_TIMEOUT_MS_MAX = 3_600_000;

/** Default wall-clock limit for remote API providers (ms). */
export const DEFAULT_REMOTE_MODEL_TIMEOUT_MS = 120_000;

/** Default wall-clock limit for local Ollama (ms). */
export const DEFAULT_OLLAMA_MODEL_TIMEOUT_MS = 600_000;

export function defaultModelTimeoutMs(provider: ModelSpec["provider"]): number {
  return provider === "ollama" ? DEFAULT_OLLAMA_MODEL_TIMEOUT_MS : DEFAULT_REMOTE_MODEL_TIMEOUT_MS;
}

export function resolveModelTimeoutMs(spec: Pick<ModelSpec, "provider" | "model" | "timeoutMs">): number {
  const configured = spec.timeoutMs;
  if (typeof configured === "number" && Number.isInteger(configured) && configured > 0) {
    return Math.min(configured, MODEL_TIMEOUT_MS_MAX);
  }
  return defaultModelTimeoutMs(spec.provider);
}

export interface StreamWatchdog {
  /** Aborts the in-flight request when the watchdog fires. */
  readonly signal: AbortSignal;
  /** `first_chunk` until output has arrived, `idle` afterwards; undefined while the timer has not fired. */
  readonly firedPhase: ModelTimeoutPhase | undefined;
  /** Restart the idle timer; call for every unit of model output. */
  touch(): void;
  /** Cancel the timer (call when the stream has finished or the consumer stopped reading). */
  stop(): void;
}

/**
 * Wall-clock guard for streaming calls. Fires when no output arrives within `timeoutMs`: before the
 * first chunk it bounds connecting plus time-to-first-token, afterwards the gap between chunks. A
 * steady stream is never capped by a total duration. The AI SDK's own `firstChunkMs` only starts
 * counting once the HTTP response is open, so a server that accepts the request and then stays
 * silent would otherwise hang forever.
 */
export function createStreamWatchdog(timeoutMs: number, onFire?: () => void): StreamWatchdog {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let seenOutput = false;
  let fired: ModelTimeoutPhase | undefined;
  const arm = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      fired = seenOutput ? "idle" : "first_chunk";
      controller.abort(new DOMException("Model stream timed out", "TimeoutError"));
      onFire?.();
    }, timeoutMs);
  };
  arm();
  return {
    signal: controller.signal,
    get firedPhase() {
      return fired;
    },
    touch() {
      if (fired) return;
      seenOutput = true;
      arm();
    },
    stop() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    },
  };
}
