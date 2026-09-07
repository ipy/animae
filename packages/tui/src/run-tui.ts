import { render } from "ink";
import { createElement } from "react";
import { TuiApp } from "./app/TuiApp.tsx";
import type { RunTuiOptions } from "./types.ts";
import { createPreparsedStdin } from "./input/preparsed-stdin.ts";

function isRealTty(stream: NodeJS.ReadableStream): boolean {
  return typeof stream === "object" && stream !== null && "isTTY" in stream && Boolean(stream.isTTY);
}

export async function runTui(opts: RunTuiOptions): Promise<void> {
  const stdout = opts.stdout ?? process.stdout;
  const stderr = opts.stderr ?? process.stderr;
  let stdin = opts.stdin ?? process.stdin;
  let disposePreparsed: (() => void) | undefined;
  if (opts.stdin === undefined && isRealTty(process.stdin)) {
    const preparsed = createPreparsedStdin(process.stdin);
    stdin = preparsed.stream;
    disposePreparsed = preparsed.dispose;
  }

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
    disposePreparsed?.();
    try {
      await opts.engine.close();
    } catch {
      /* ignore */
    }
    instance.cleanup();
  }
}
