import type { Engine, SceneId } from "@animae/engine";
import type { CommandApi } from "../../src/types.ts";
import { createTuiFakeEngine } from "./fake-engine.ts";

export type NotifyNote = { text: string; level?: "info" | "warn" | "error" };

export interface TestCommandApi {
  api: CommandApi;
  notes: NotifyNote[];
}

export function createTestCommandApi(
  overrides: Partial<CommandApi> = {},
  engine?: Engine,
): TestCommandApi {
  const notes: NotifyNote[] = [];
  const eng = engine ?? createTuiFakeEngine();
  const api: CommandApi = {
    engine: eng,
    viewer: "player",
    actor: "player",
    notify: (text, level) => {
      notes.push({ text, level });
    },
    openOverlay: () => {},
    closeOverlay: () => {},
    sceneId: () => "scn_0001",
    startScene: async () => "scn_0001" as SceneId,
    endScene: async () => {},
    setMouseCapture: () => {},
    setUiLocale: () => {},
    locale: () => "en",
    t: (key, params) => (params !== undefined ? `${key}:${JSON.stringify(params)}` : key),
    ...overrides,
  };
  return { api, notes };
}
