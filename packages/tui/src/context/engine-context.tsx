import { createContext, useContext, type ReactNode } from "react";
import type { Engine, Viewer } from "../types.ts";

export interface EngineContextValue {
  engine: Engine;
  viewer: Viewer;
  actor: string;
  /** Host-provided display name for a character id (transcript speaker labels, participant tracks). */
  displayName?: (id: string) => string | undefined;
}

const EngineContext = createContext<EngineContextValue | undefined>(undefined);

export function EngineProvider({
  value,
  children,
}: {
  value: EngineContextValue;
  children: ReactNode;
}) {
  return <EngineContext.Provider value={value}>{children}</EngineContext.Provider>;
}

export function useEngineContext(): EngineContextValue {
  const ctx = useContext(EngineContext);
  if (!ctx) throw new Error("useEngineContext requires EngineProvider");
  return ctx;
}
