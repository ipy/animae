import { useStdout, useWindowSize } from "ink";
import { createContext, useContext, type ReactNode } from "react";

export interface TerminalSize {
  columns: number;
  rows: number;
}

const TerminalSizeOverride = createContext<TerminalSize | undefined>(undefined);

export function TerminalSizeProvider({
  size,
  children,
}: {
  size?: Partial<TerminalSize>;
  children: ReactNode;
}) {
  const value =
    size?.columns !== undefined && size?.rows !== undefined
      ? { columns: size.columns, rows: size.rows }
      : undefined;
  return <TerminalSizeOverride.Provider value={value}>{children}</TerminalSizeOverride.Provider>;
}

/** Terminal cell size: explicit `stdout` dimensions, provider override, then Ink window size. */
export function useTerminalSize(): TerminalSize {
  const override = useContext(TerminalSizeOverride);
  if (override) return override;
  const ink = useWindowSize();
  const stdout = useStdout().stdout as { columns?: number; rows?: number };
  return {
    columns: typeof stdout.columns === "number" ? stdout.columns : ink.columns,
    rows: typeof stdout.rows === "number" ? stdout.rows : ink.rows,
  };
}
