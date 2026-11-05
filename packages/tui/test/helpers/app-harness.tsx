import { PassThrough, Readable } from "node:stream";
import { render } from "ink";
import { createElement } from "react";
import { TuiApp } from "../../src/app/TuiApp.tsx";
import type { RunTuiOptions } from "../../src/types.ts";
import { stripAnsi, waitMs } from "./ink-harness.ts";

class MockTtyIn extends Readable {
  isTTY = true;
  setRawMode(_mode: boolean): void {}
  ref(): void {}
  unref(): void {}
  override _read(): void {}
}

export const KEYS = {
  enter: "\r",
  escape: "\x1b",
  up: "\x1b[A",
  down: "\x1b[B",
  f1: "\x1bOP",
  f2: "\x1bOQ",
  f3: "\x1bOR",
  f4: "\x1bOS",
  f5: "\x1b[15~",
  f6: "\x1b[17~",
  ctrlS: "\x13",
  ctrlC: "\x03",
  tab: "\t",
  pageDown: "\x1b[6~",
} as const;

export type MountTuiSize = { columns: number; rows: number };

/**
 * The whole TUI on a mock terminal: keys go in through `press`, and `finish()` returns the last frame the user would
 * see (Ink only flushes a frame to a non-interactive stream when it unmounts).
 */
export function mountTui(options: Omit<RunTuiOptions, "stdin" | "stdout" | "mouse">, size: MountTuiSize = { columns: 120, rows: 40 }) {
  const stdout = new PassThrough() as PassThrough & { columns: number; rows: number };
  stdout.columns = size.columns;
  stdout.rows = size.rows;
  let frame = "";
  stdout.on("data", (chunk: Buffer) => {
    frame += chunk.toString("utf8");
  });
  const stdin = new MockTtyIn();
  const instance = render(
    createElement(TuiApp, { scene: { sceneId: "scn_0001" }, ...options, mouse: false, stdin, stdout } as never),
    {
      stdout,
      stdin: stdin as never,
      stderr: new PassThrough(),
      alternateScreen: false,
      interactive: false,
      patchConsole: false,
      exitOnCtrlC: false,
    },
  );
  return {
    async press(...keys: string[]): Promise<void> {
      for (const key of keys) {
        stdin.push(key);
        // A lone Esc is flushed after a short pause (to tell it apart from an escape sequence).
        await waitMs(key === KEYS.escape ? 120 : 40);
      }
    },
    async type(text: string): Promise<void> {
      for (const ch of text) {
        stdin.push(ch);
        await waitMs(5);
      }
      await waitMs(30);
    },
    async finish(settleMs = 60): Promise<string[]> {
      await waitMs(settleMs);
      instance.unmount();
      await waitMs(30);
      return stripAnsi(frame)
        .split("\n")
        .map((l) => l.trimEnd());
    },
  };
}
