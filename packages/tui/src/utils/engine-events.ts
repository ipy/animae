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

export function subscribeEngineEvents(
  engine: Engine,
  handler: (e: EngineEvent) => void,
  kinds: string[] = QUERY_EVENT_KINDS,
): () => void {
  const offs = kinds.map((k) => engine.on(k, handler));
  return () => offs.forEach((off) => off());
}
