import type { Engine, EngineEvent } from "@animae/engine";

const QUERY_EVENT_KINDS = [
  "track.delta",
  "time.advanced",
  "scene.started",
  "scene.ended",
  "scene.turn",
  "world.moved",
  "world.var_set",
  "field.applied",
  "field.revoked",
  "anchor.opened",
  "anchor.closed",
  "beat.advanced",
  "beat.completed",
  "route.decided",
];

/**
 * Navigating the timeline (rewind, load, switch) can change what every query returns without emitting any of the kinds
 * above, so whoever navigates tells the query hooks through this registry.
 */
const navigationListeners = new WeakMap<Engine, Set<() => void>>();

export function notifyTimelineNavigated(engine: Engine): void {
  for (const listener of navigationListeners.get(engine) ?? []) listener();
}

export function subscribeEngineEvents(
  engine: Engine,
  handler: (e: EngineEvent) => void,
  kinds: string[] = QUERY_EVENT_KINDS,
): () => void {
  const offs = kinds.map((k) => engine.on(k, handler));
  return () => offs.forEach((off) => off());
}

/** Calls `onChange` when what a query shows may have changed: a world event happened, or the timeline was navigated. */
export function subscribeQueryChanges(engine: Engine, onChange: () => void): () => void {
  const off = subscribeEngineEvents(engine, onChange);
  let listeners = navigationListeners.get(engine);
  if (!listeners) {
    listeners = new Set();
    navigationListeners.set(engine, listeners);
  }
  listeners.add(onChange);
  return () => {
    off();
    listeners.delete(onChange);
  };
}
