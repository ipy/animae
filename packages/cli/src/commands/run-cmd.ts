import { printError } from "../errors.ts";
import { openEngine, type OpenEngineOptions } from "../engine-open.ts";
import { runPlainRepl } from "../plain/repl.ts";

export interface RunCommandOptions extends OpenEngineOptions {
  scene?: string;
  withIds?: string[];
  viewer?: string;
  theme?: string;
  plain?: boolean;
}

function participants(opts: RunCommandOptions): string[] {
  return [...new Set(["player", ...(opts.withIds ?? [])])];
}

async function startTui(
  engine: import("@animae/engine").Engine,
  sceneId: import("@animae/engine").SceneId,
  opts: RunCommandOptions,
): Promise<number> {
  const mod = await import("@animae/tui");
  const runTui = (mod as { runTui?: (o: unknown) => Promise<void> }).runTui;
  if (typeof runTui !== "function") {
    process.stderr.write("@animae/tui runTui() is not available yet — use --plain or wait for the TUI package.\n");
    return 1;
  }

  await runTui({
    engine,
    viewer: (opts.viewer ?? "player") as import("@animae/engine").Viewer,
    scene: { sceneId },
    theme: opts.theme,
    uiLocale: opts.lang ?? engine.info().locale,
  });
  return 0;
}

export async function runRunCommand(opts: RunCommandOptions): Promise<number> {
  let engine;
  try {
    engine = await openEngine(opts);
  } catch (err) {
    printError(err);
    return 1;
  }

  try {
    const loc =
      opts.scene ??
      (() => {
        const v = engine.query("debug", "world/location");
        return typeof v === "string" && v ? v : "home";
      })();
    const sceneId = await engine.scene.start({ location: loc, participants: participants(opts) });

    if (opts.plain) {
      return await runPlainRepl({
        engine,
        sceneId,
        viewer: (opts.viewer ?? "player") as import("@animae/engine").Viewer,
      });
    }

    return await startTui(engine, sceneId, opts);
  } catch (err) {
    printError(err);
    return 1;
  } finally {
    await engine.close();
  }
}
