import type { ModelsInfo, RuntimeMode, SwitchAt } from "@animae/engine";
import { useAppState } from "../context/app-state-context.tsx";
import { useEngineContext } from "../context/engine-context.tsx";
import { hasRuntime } from "../utils/mode-display.ts";

export interface RuntimeModeView {
  /** The mode new turns start under. */
  mode: RuntimeMode;
  /** The mode that applies at the next turn boundary, when a change is queued. */
  pending: RuntimeMode | null;
  models: ModelsInfo;
  switchAt: SwitchAt;
}

/**
 * Which backend serves S1 and S2 right now. The engine is the source of truth: the values are read on every render
 * and the view re-renders when `modeTick` moves (a `runtime.mode_changed` event or a switch requested from the UI).
 * `undefined` for engines that have no runtime to show (test doubles).
 */
export function useRuntimeMode(): RuntimeModeView | undefined {
  const { engine } = useEngineContext();
  // Reading the tick subscribes this view to mode changes.
  useAppState().state.modeTick;
  if (!hasRuntime(engine)) return undefined;
  return {
    mode: engine.runtime.mode(),
    pending: engine.runtime.pending(),
    models: engine.runtime.models(),
    switchAt: engine.runtime.switchAt,
  };
}
