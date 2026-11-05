import type { Engine, RuntimeModePreset, RuntimeModeRequest } from "@animae/engine";
import { formatMode, hasRuntime } from "./mode-display.ts";

/** What asking the engine for another runtime mode did. */
export type ModeSwitchOutcome =
  /** The engine has no runtime mode to switch (test doubles). */
  | { kind: "unsupported" }
  /** The request matches the current mode (or undid a queued change). */
  | { kind: "unchanged"; mode: string }
  /** The new mode is active; the engine announces it as `runtime.mode_changed`. */
  | { kind: "applied"; before: string; after: string }
  /** A turn is running: the change waits for the turn boundary. */
  | { kind: "queued"; after: string };

/**
 * Ask the engine to serve S1 and S2 from other backends. Errors from the engine (`MODE_UNAVAILABLE` when a role has no
 * model, `MODE_UNKNOWN_TIER`, `MODE_INVALID`) are not caught: callers show them as warnings.
 */
export async function requestMode(
  engine: Engine,
  req: RuntimeModeRequest | RuntimeModePreset,
  trigger: string,
): Promise<ModeSwitchOutcome> {
  if (!hasRuntime(engine)) return { kind: "unsupported" };
  const models = engine.runtime.models();
  const change = await engine.runtime.setMode(req, { reason: "api", trigger });
  const before = formatMode(change.before, models);
  const after = formatMode(change.after, models);
  if (change.pending) return { kind: "queued", after };
  if (before === after) return { kind: "unchanged", mode: after };
  return { kind: "applied", before, after };
}
