import type { Engine, Viewer } from "../types.ts";

export interface CharacterNameSource {
  engine: Engine;
  viewer: Viewer;
  /** Host-provided resolver (the engine's `identity` query is often redacted for the player viewer). */
  displayName?: (id: string) => string | undefined;
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

/**
 * Display name for a character id: the host resolver first, then the card identity the viewer may read.
 * `undefined` when neither knows the character (callers fall back to the raw id).
 */
export function characterDisplayName(source: CharacterNameSource, id: string): string | undefined {
  const hosted = nonEmpty(source.displayName?.(id));
  if (hosted) return hosted;
  const identity = source.engine.query(source.viewer, `characters/${id}/identity`) as
    | { name?: unknown }
    | undefined;
  return nonEmpty(identity?.name);
}
