import type { Engine, SceneId } from "@animae/engine";
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

/**
 * The scene `run` plays in. A scene that is still open on the timeline (the previous session ended without closing
 * it) is resumed when it matches the request: no `--scene`, or the same location, and every `--with` participant
 * already in it. Anything else starts a new scene, which the engine refuses while another one is open.
 */
async function sceneForRun(engine: Engine, opts: RunCommandOptions): Promise<SceneId> {
  const wanted = participants(opts);
  const active = engine.scene.active();
  if (
    active &&
    (opts.scene === undefined || opts.scene === active.location) &&
    wanted.every((p) => active.participants.includes(p))
  ) {
    return active.id;
  }
  const location =
    opts.scene ??
    (() => {
      const v = engine.query("debug", "world/location");
      return typeof v === "string" && v ? v : "home";
    })();
  return engine.scene.start({ location, participants: wanted });
}

/** Injection points for `runRunCommand`; production callers use the defaults. */
export interface RunCommandDeps {
  /** Loads the TUI lazily, so `--plain` runs never pay for Ink/React. */
  loadTui?: () => Promise<Pick<typeof import("@animae/tui"), "runTui">>;
}

async function startTui(
  engine: import("@animae/engine").Engine,
  sceneId: import("@animae/engine").SceneId,
  opts: RunCommandOptions,
  loadTui: NonNullable<RunCommandDeps["loadTui"]>,
): Promise<number> {
  const { runTui } = await loadTui();
  await runTui({
    engine,
    viewer: (opts.viewer ?? "player") as import("@animae/engine").Viewer,
    scene: { sceneId },
    theme: opts.theme,
    uiLocale: opts.lang ?? engine.info().locale,
  });
  return 0;
}

export async function runRunCommand(opts: RunCommandOptions, deps: RunCommandDeps = {}): Promise<number> {
  let engine;
  try {
    engine = await openEngine(opts);
  } catch (err) {
    printError(err);
    return 1;
  }

  try {
    const sceneId = await sceneForRun(engine, opts);

    if (opts.plain) {
      return await runPlainRepl({
        engine,
        sceneId,
        viewer: (opts.viewer ?? "player") as import("@animae/engine").Viewer,
        locale: opts.lang ?? engine.info().locale,
      });
    }

    return await startTui(engine, sceneId, opts, deps.loadTui ?? (() => import("@animae/tui")));
  } catch (err) {
    printError(err);
    return 1;
  } finally {
    await engine.close();
  }
}
