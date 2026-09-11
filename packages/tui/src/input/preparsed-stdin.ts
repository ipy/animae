import { PassThrough } from "node:stream";
import type { ReadStream } from "node:tty";
import { createInputParser } from "../ink/vendor/input-parser.js";
import { parseSgrMouseChunk } from "./mouse-sgr.ts";
import { emitPreparsedMouse } from "./preparsed-mouse-bus.ts";

const ESC_FLUSH_MS = 50;

type TtyIn = ReadStream & {
  setRawMode?(mode: boolean): void;
  ref?: () => void;
  unref?: () => void;
};

function asTtyStdin(stream: NodeJS.ReadableStream): TtyIn | undefined {
  if (
    stream &&
    typeof stream === "object" &&
    "setRawMode" in stream &&
    typeof (stream as TtyIn).setRawMode === "function"
  ) {
    return stream as TtyIn;
  }
  return undefined;
}

function createInkStdinFeed(tty: TtyIn): PassThrough & { isTTY: true; setRawMode(mode: boolean): void } {
  const stream = new PassThrough() as PassThrough & {
    isTTY: true;
    setRawMode(mode: boolean): void;
    ref(): void;
    unref(): void;
  };
  stream.isTTY = true;
  stream.setRawMode = (mode: boolean) => {
    tty.setRawMode?.(mode);
  };
  stream.ref = () => tty.ref?.();
  stream.unref = () => tty.unref?.();
  return stream;
}

/**
 * Single consumer of real stdin: strip SGR mouse, assemble keys/paste with a 50ms Esc
 * window, feed Ink a TTY-capable PassThrough so SS3/CSI are never split by Ink's 20ms flush.
 */
export function createPreparsedStdin(underlying: NodeJS.ReadableStream): {
  stream: PassThrough;
  dispose: () => void;
} {
  const tty = asTtyStdin(underlying);
  const stream = tty ? createInkStdinFeed(tty) : new PassThrough();
  const parser = createInputParser();
  /** Incremental UTF-8 decode so split multibyte keystrokes are not U+FFFD. */
  const utf8Decoder = new TextDecoder("utf-8", { fatal: false });
  let mousePending = "";
  let pendingTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  const clearTimer = () => {
    if (pendingTimer !== undefined) {
      clearTimeout(pendingTimer);
      pendingTimer = undefined;
    }
  };

  const scheduleEscFlush = () => {
    clearTimer();
    pendingTimer = setTimeout(() => {
      pendingTimer = undefined;
      const pending = parser.flushPendingEscape();
      if (pending) stream.write(pending);
    }, ESC_FLUSH_MS);
  };

  const feedKeyboard = (text: string) => {
    if (!text) return;
    for (const event of parser.push(text)) {
      if (typeof event === "string") {
        stream.write(event);
      } else {
        stream.write(`\x1b[200~${event.paste}\x1b[201~`);
      }
    }
    if (parser.hasPendingEscape()) scheduleEscFlush();
  };

  const onTerminalInputClosed = () => {
    if (disposed) return;
    onReadable();
    dispose();
    stream.end();
  };

  const onReadable = () => {
    if (disposed) return;
    clearTimer();
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    while (true) {
      if ((underlying as NodeJS.ReadableStream & { readableEnded?: boolean }).readableEnded === true) {
        break;
      }
      const raw = underlying.read();
      if (raw === null) break;
      const chunk =
        typeof raw === "string"
          ? raw
          : utf8Decoder.decode(Buffer.isBuffer(raw) ? raw : Buffer.from(raw), { stream: true });
      const mouseParsed = parseSgrMouseChunk(mousePending, chunk);
      mousePending = mouseParsed.pending;
      for (const ev of mouseParsed.events) emitPreparsedMouse(ev);
      feedKeyboard(mouseParsed.rest);
    }
  };

  underlying.on("readable", onReadable);
  underlying.on("end", onTerminalInputClosed);
  underlying.on("close", onTerminalInputClosed);
  underlying.on("error", onTerminalInputClosed);
  if (underlying.readable) onReadable();

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    clearTimer();
    underlying.removeListener("readable", onReadable);
    underlying.removeListener("end", onTerminalInputClosed);
    underlying.removeListener("close", onTerminalInputClosed);
    underlying.removeListener("error", onTerminalInputClosed);
    const tail = utf8Decoder.decode();
    if (tail) {
      const mouseParsed = parseSgrMouseChunk(mousePending, tail);
      mousePending = mouseParsed.pending;
      for (const ev of mouseParsed.events) emitPreparsedMouse(ev);
      feedKeyboard(mouseParsed.rest);
    }
    stream.end();
  };

  return { stream, dispose };
}
