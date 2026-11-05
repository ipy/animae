import type { Engine, Viewer } from "../types.ts";

/** Player-visible reads that need lazy catch-up (spec 12.6) use `queryAsync` when implemented. */
export async function queryEngine(engine: Engine, viewer: Viewer, path: string): Promise<unknown> {
  if (viewer === "player" && typeof engine.queryAsync === "function") {
    return engine.queryAsync(viewer, path);
  }
  return engine.query(viewer, path);
}

export function shouldUseQueryAsync(viewer: Viewer, engine: Engine): boolean {
  return viewer === "player" && typeof engine.queryAsync === "function";
}
