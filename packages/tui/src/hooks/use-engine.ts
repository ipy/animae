import { useEngineContext } from "../context/engine-context.tsx";

export function useEngine() {
  return useEngineContext().engine;
}
