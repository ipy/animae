import { PassThrough } from "node:stream";
import { render } from "ink";
import { createElement, type ReactNode } from "react";

export function stripAnsi(text: string): string {
  return text
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")
    .replace(/\x1b\][^\x07]*(\x07|\x1b\\)/g, "");
}

export function createInkHarness(node: ReactNode) {
  const stdout = new PassThrough();
  const stdin = new PassThrough();
  let frame = "";
  stdout.on("data", (chunk: Buffer) => {
    frame += chunk.toString("utf8");
  });
  const instance = render(createElement(() => node), {
    stdout,
    stdin,
    stderr: new PassThrough(),
    alternateScreen: false,
    interactive: false,
    patchConsole: false,
    exitOnCtrlC: false,
    incrementalRendering: true,
    maxFps: 60,
  });
  let unmounted = false;
  return {
    stdout,
    stdin,
    getFrame: () => stripAnsi(frame),
    getRawFrame: () => frame,
    unmount: () => {
      if (unmounted) return;
      unmounted = true;
      instance.unmount();
      instance.cleanup();
    },
  };
}

/** Ink only writes the final frame to a non-interactive stdout when the tree unmounts. */
export async function flushInkFrame(
  harness: ReturnType<typeof createInkHarness>,
  settleMs = 80,
): Promise<string> {
  await waitMs(settleMs);
  harness.unmount();
  await waitMs(20);
  return harness.getFrame();
}

export function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
