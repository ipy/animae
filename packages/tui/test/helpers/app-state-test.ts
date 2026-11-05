import { initialAppState, type AppState } from "../../src/context/app-state-context.tsx";

export function testAppState(overrides: Partial<AppState> = {}): AppState {
  return { ...initialAppState(), ...overrides };
}
