import { renderToString } from "ink";
import type { ReactElement } from "react";
import { stripAnsi } from "./ink-harness.ts";

export type TerminalStdout = { columns: number; rows: number; isTTY?: boolean };

/** Static Ink frame with explicit terminal dimensions (Ink 8: size lives on `stdout`). */
export function renderTuiToString(element: ReactElement, stdout: TerminalStdout): string {
  return stripAnsi(
    renderToString(element, { stdout: stdout as never } as Parameters<typeof renderToString>[1]),
  );
}
