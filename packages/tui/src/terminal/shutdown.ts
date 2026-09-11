/** Exit Ink / the process when the controlling terminal or pipes go away. */

import type { EventEmitter } from "node:events";

const DEFAULT_HARD_EXIT_MS = 2000;

function asEmitter(stream: NodeJS.ReadableStream | NodeJS.WritableStream): EventEmitter {
  return stream as EventEmitter;
}

function isBrokenPipe(err: unknown): boolean {
  if (typeof err !== "object" || err === null || !("code" in err)) return false;
  const code = (err as { code?: string }).code;
  return code === "EPIPE" || code === "EIO";
}

export type TerminalShutdownReason =
  | "SIGHUP"
  | "SIGINT"
  | "SIGTERM"
  | "stdin-end"
  | "stdin-close"
  | "stdin-error"
  | "stdout-error"
  | "stderr-error";

export function installTerminalShutdown(opts: {
  stdin?: NodeJS.ReadableStream;
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
  onShutdown: (reason: TerminalShutdownReason) => void;
  hardExitMs?: number;
}): () => void {
  const stdin = opts.stdin ?? process.stdin;
  const stdout = opts.stdout ?? process.stdout;
  const stderr = opts.stderr ?? process.stderr;
  const hardExitMs = opts.hardExitMs ?? DEFAULT_HARD_EXIT_MS;
  let fired = false;
  let hardTimer: ReturnType<typeof setTimeout> | undefined;

  const shutdown = (reason: TerminalShutdownReason) => {
    if (fired) return;
    fired = true;
    try {
      opts.onShutdown(reason);
    } catch {
      /* ignore */
    }
    hardTimer = setTimeout(() => {
      process.exit(0);
    }, hardExitMs);
  };

  const onStdinEnd = () => shutdown("stdin-end");
  const onStdinClose = () => shutdown("stdin-close");
  const onStdinError = () => shutdown("stdin-error");
  const onStdoutError = (err: unknown) => {
    if (isBrokenPipe(err)) shutdown("stdout-error");
  };
  const onStderrError = (err: unknown) => {
    if (isBrokenPipe(err)) shutdown("stderr-error");
  };
  const onHup = () => shutdown("SIGHUP");
  const onTerm = () => shutdown("SIGTERM");

  const inEv = asEmitter(stdin);
  const outEv = asEmitter(stdout);
  const errEv = asEmitter(stderr);
  inEv.on("end", onStdinEnd);
  inEv.on("close", onStdinClose);
  inEv.on("error", onStdinError);
  outEv.on("error", onStdoutError);
  errEv.on("error", onStderrError);
  process.on("SIGHUP", onHup);
  process.on("SIGTERM", onTerm);

  return () => {
    if (hardTimer !== undefined) clearTimeout(hardTimer);
    inEv.off("end", onStdinEnd);
    inEv.off("close", onStdinClose);
    inEv.off("error", onStdinError);
    outEv.off("error", onStdoutError);
    errEv.off("error", onStderrError);
    process.off("SIGHUP", onHup);
    process.off("SIGTERM", onTerm);
  };
}
