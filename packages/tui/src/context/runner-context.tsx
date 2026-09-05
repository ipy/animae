import { createContext, useContext, type ReactNode } from "react";

const RunnerContext = createContext<{ onQuit: () => void }>({ onQuit: () => {} });

export function RunnerProvider({
  onQuit,
  children,
}: {
  onQuit: () => void;
  children: ReactNode;
}) {
  return <RunnerContext.Provider value={{ onQuit }}>{children}</RunnerContext.Provider>;
}

export function useRunner(): { onQuit: () => void } {
  return useContext(RunnerContext);
}
