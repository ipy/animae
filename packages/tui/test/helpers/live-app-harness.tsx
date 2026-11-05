import { PassThrough, Readable } from "node:stream";
import { render } from "ink";
import { createElement } from "react";
import type { Engine } from "@animae/engine";
import { TuiApp } from "../../src/app/TuiApp.tsx";
import type { RunTuiOptions } from "../../src/types.ts";
import { KEYS, type MountTuiSize } from "./app-harness.tsx";
import { stripAnsi, waitMs } from "./ink-harness.ts";
import { preparsedMouseBus } from "../../src/input/preparsed-mouse-bus.ts";

export { KEYS };

class MockTtyIn extends Readable {
  isTTY = true;
  setRawMode(_mode: boolean): void {}
  ref(): void {}
  unref(): void {}
  override _read(): void {}
}

export interface LiveTuiMount {
  press(...keys: string[]): Promise<void>;
  type(text: string): Promise<void>;
  /** Delivers every key in the same tick, as a fast typist, a key repeat or a paste would, then lets the UI settle. */
  burst(...keys: string[]): Promise<void>;
  resize(size: MountTuiSize): void;
  getText(): string;
  getLines(): string[];
  pollUntil(match: (text: string) => boolean, deadlineMs?: number): Promise<boolean>;
  finish(settleMs?: number): Promise<string[]>;
  unmount(): void;
}

/**
 * Full TuiApp on a mock TTY with incremental frames (interactive Ink) so multi-step flows can be
 * driven before a single unmount.
 */
export function mountLiveTui(
  options: Omit<RunTuiOptions, "stdin" | "stdout">,
  size: MountTuiSize = { columns: 120, rows: 40 },
): LiveTuiMount {
  const stdout = new PassThrough() as PassThrough & { columns: number; rows: number; isTTY: boolean };
  stdout.columns = size.columns;
  stdout.rows = size.rows;
  stdout.isTTY = true;
  let rawOut = "";
  stdout.on("data", (chunk: Buffer) => {
    rawOut += chunk.toString("utf8");
  });

  const extractFrameText = (): string => {
    const parts = rawOut.split("\x1b[?2026l");
    if (parts.length > 1) {
      const segment = parts[parts.length - 2] ?? "";
      const h = segment.lastIndexOf("\x1b[?2026h");
      const body = h >= 0 ? segment.slice(h + "\x1b[?2026h".length) : segment;
      const parsed = stripAnsi(body);
      if (parsed.trim().length > 0) return parsed;
    }
    return stripAnsi(rawOut);
  };
  const stdin = new MockTtyIn();
  const instance = render(
    createElement(TuiApp, { ...options, mouse: options.mouse ?? false, stdin, stdout } as never),
    {
      stdout,
      stdin: stdin as never,
      stderr: new PassThrough(),
      alternateScreen: false,
      interactive: true,
      patchConsole: false,
      exitOnCtrlC: false,
      incrementalRendering: false,
      maxFps: 60,
    },
  );

  let unmounted = false;
  const terminalRows = () => stdout.rows;
  const getText = () => extractFrameText();
  /** Terminal-aligned rows (length = terminal height) for SGR mouse coordinates. */
  const getLines = (): string[] => {
    const split = getText().split("\n").map((l) => l.trimEnd());
    const rows = terminalRows();
    if (split.length >= rows) return split.slice(0, rows);
    const pad = rows - split.length;
    return [...Array<string>(pad).fill(""), ...split];
  };

  return {
    async press(...keys: string[]): Promise<void> {
      for (const key of keys) {
        stdin.push(key);
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
    async burst(...keys: string[]): Promise<void> {
      for (const key of keys) stdin.push(key);
      await waitMs(80);
    },
    resize(next: MountTuiSize) {
      stdout.columns = next.columns;
      stdout.rows = next.rows;
    },
    getText,
    getLines,
    async pollUntil(match, deadlineMs = 4000) {
      const start = Date.now();
      while (Date.now() - start < deadlineMs) {
        if (match(getText())) return true;
        await waitMs(40);
      }
      return false;
    },
    async finish(settleMs = 60) {
      await waitMs(settleMs);
      if (!unmounted) {
        unmounted = true;
        preparsedMouseBus.removeAllListeners("sgr");
        instance.unmount();
        instance.cleanup();
        await waitMs(30);
      }
      return getLines();
    },
    unmount() {
      if (unmounted) return;
      unmounted = true;
      preparsedMouseBus.removeAllListeners("sgr");
      instance.unmount();
      instance.cleanup();
    },
  };
}

export async function openRuleScene(engine: Engine): Promise<string> {
  return engine.scene.start({ location: "tavern", participants: ["player", "npc1"] });
}
