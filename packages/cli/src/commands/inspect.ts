import { printError } from "../errors.ts";
import { openEngine, type OpenEngineOptions } from "../engine-open.ts";

export async function runInspect(
  opts: OpenEngineOptions & { path: string; viewer?: string },
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
    const value = engine.query(viewer, opts.path);
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
    return 0;
  } catch (err) {
    printError(err);
    return 1;
  } finally {
    await engine.close();
  }
}
