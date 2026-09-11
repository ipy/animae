import { render } from "ink";
import { createElement } from "react";
import { TuiApp } from "./app/TuiApp.tsx";
import type { RunTuiOptions } from "./types.ts";
import { createPreparsedStdin } from "./input/preparsed-stdin.ts";
import { installTerminalShutdown } from "./terminal/shutdown.ts";

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

  const realStdin = opts.stdin ?? process.stdin;
  let terminalLost = false;
  const uninstallShutdown = installTerminalShutdown({
    stdin: realStdin,
    stdout,
    stderr,
    onShutdown: () => {
      terminalLost = true;
      try {
        instance.unmount();
      } catch {
        /* ignore */
      }
    },
  });

  let terminalLostPoll: ReturnType<typeof setInterval> | undefined;
  const waitTerminalLost = new Promise<void>((resolve) => {
    if (terminalLost) {
      resolve();
      return;
    }
    terminalLostPoll = setInterval(() => {
      if (terminalLost) {
        if (terminalLostPoll !== undefined) clearInterval(terminalLostPoll);
        resolve();
      }
    }, 25);
    terminalLostPoll.unref?.();
  });

  try {
    await Promise.race([instance.waitUntilExit(), waitTerminalLost]);
  } finally {
    if (terminalLostPoll !== undefined) clearInterval(terminalLostPoll);
    uninstallShutdown();
    disposePreparsed?.();
    try {
      await opts.engine.close();
    } catch {
      /* ignore */
    }
    instance.cleanup();
  }
}
