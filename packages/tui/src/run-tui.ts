import { render } from "ink";
import { createElement } from "react";
import { TuiApp } from "./app/TuiApp.tsx";
import type { RunTuiOptions } from "./types.ts";

export async function runTui(opts: RunTuiOptions): Promise<void> {
  const stdout = opts.stdout ?? process.stdout;
  const stdin = opts.stdin ?? process.stdin;
  const stderr = opts.stderr ?? process.stderr;

  const instance = render(createElement(TuiApp, opts), {
    stdout,
    stdin,
    stderr,
    alternateScreen: true,
    exitOnCtrlC: false,
    patchConsole: true,
    incrementalRendering: true,
    maxFps: 30,
  });

  try {
    await instance.waitUntilExit();
  } finally {
    try {
      await opts.engine.close();
    } catch {
      /* ignore */
    }
    instance.cleanup();
  }
}
