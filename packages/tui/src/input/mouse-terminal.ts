/** Enable / disable xterm mouse reporting (SGR 1006). */

export const MOUSE_MODE_ON = "\u001b[?1000h\u001b[?1002h\u001b[?1006h";
export const MOUSE_MODE_ON_HOVER = "\u001b[?1003h";
export const MOUSE_MODE_OFF =
  "\u001b[?1003l\u001b[?1006l\u001b[?1002l\u001b[?1000l";

export type MouseTerminalMode = "off" | "basic" | "hover";

export function writeMouseMode(
  stdout: NodeJS.WritableStream,
  mode: MouseTerminalMode,
): void {
  if (mode === "off") {
    stdout.write(MOUSE_MODE_OFF);
    return;
  }
  stdout.write(MOUSE_MODE_ON);
  if (mode === "hover") stdout.write(MOUSE_MODE_ON_HOVER);
}

function isNodeTty(stream: unknown): boolean {
  return Boolean(stream && typeof stream === "object" && "isTTY" in stream && (stream as { isTTY?: boolean }).isTTY);
}

export function resolveMouseEnabled(opts: {
  mouse?: boolean | "auto";
  stdout?: NodeJS.WritableStream;
  stdin?: NodeJS.ReadableStream;
}): { enabled: boolean; hover: boolean } {
  if (process.env.NO_MOUSE === "1") return { enabled: false, hover: false };
  if (opts.mouse === false) return { enabled: false, hover: false };
  const stdout = opts.stdout ?? process.stdout;
  const stdin = opts.stdin ?? process.stdin;
  const tty = isNodeTty(stdout) && isNodeTty(stdin);
  if (opts.mouse === true) return { enabled: tty, hover: tty };
  if (opts.mouse === "auto" || opts.mouse === undefined) return { enabled: tty, hover: tty };
  return { enabled: false, hover: false };
}

const cleanupHandlers = new Set<() => void>();

export function registerMouseTerminalCleanup(cleanup: () => void): () => void {
  cleanupHandlers.add(cleanup);
  return () => cleanupHandlers.delete(cleanup);
}

export function installGlobalMouseCleanup(stdout: NodeJS.WritableStream): () => void {
  const disable = () => {
    try {
      if (isNodeTty(stdout)) writeMouseMode(stdout, "off");
    } catch {
      /* ignore */
    }
  };
  const onSignal = () => disable();
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  process.once("exit", disable);
  process.once("uncaughtException", disable);
  process.once("unhandledRejection", disable);
  registerMouseTerminalCleanup(disable);
  return () => {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    process.off("exit", disable);
    disable();
  };
}
