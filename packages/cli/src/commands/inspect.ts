import { printError } from "../errors.ts";
import { openEngine, type OpenEngineOptions } from "../engine-open.ts";

export async function runInspect(
  opts: OpenEngineOptions & { path: string; viewer?: string; /** keep only events of this kind (the `events` path) */ eventKind?: string },
): Promise<number> {
  let engine;
  try {
    engine = await openEngine(opts);
  } catch (err) {
    printError(err);
    return 1;
  }

  try {
    const viewer = (opts.viewer ?? "player") as import("@animae/engine").Viewer;
    let value =
      viewer === "player" && typeof engine.queryAsync === "function"
        ? await engine.queryAsync(viewer, opts.path)
        : engine.query(viewer, opts.path);
    if (opts.eventKind !== undefined && Array.isArray(value)) {
      value = value.filter((e) => (e as { kind?: string }).kind === opts.eventKind);
    }
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
    return 0;
  } catch (err) {
    printError(err);
    return 1;
  } finally {
    await engine.close();
  }
}
