import { createContext, useContext, type ReactNode } from "react";
import type { Engine, Viewer } from "../types.ts";

export interface EngineContextValue {
  engine: Engine;
  viewer: Viewer;
  actor: string;
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
