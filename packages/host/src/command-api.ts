import type { Engine, Viewer } from "@animae/engine";
import type { SceneId } from "@animae/engine";
import { guardCommandApi } from "./command-api-contract.ts";
import type { HostCommandApi, HostCommandUiBridge } from "./types.ts";

export interface CommandApiState {
  sceneId?: string;
  sceneParticipants?: string[];
}

export function createHostCommandApi(
  engine: Engine,
  viewer: Viewer,
  actor: string,
  state: CommandApiState,
  notify: (text: string, level?: "info" | "warn" | "error") => void,
  ui: HostCommandUiBridge,
  i18n?: {
    locale: () => string;
    t: (key: string, params?: Record<string, string | number | boolean | null | undefined>) => string;
  },
): HostCommandApi {
  const api: HostCommandApi = {
    engine,
    viewer,
    actor,
    sceneId() {
      return state.sceneId;
    },
    async startScene(s) {
      const id = await engine.scene.start(s);
      state.sceneId = id;
      state.sceneParticipants = s.participants.filter((p) => p !== actor);
      return id;
    },
    async endScene() {
      const sid = state.sceneId;
      if (!sid) return;
      await engine.scene.end(sid);
      state.sceneId = undefined;
      state.sceneParticipants = undefined;
    },
    attachScene(id) {
      state.sceneId = id;
    },
    notify,
    openOverlay(name) {
      ui.openOverlay(name);
    },
    closeOverlay() {
      ui.closeOverlay();
    },
    setMouseCapture(on) {
      ui.setMouseCapture(on);
    },
    locale() {
      return i18n?.locale() ?? "en";
    },
    t(key, params) {
      return i18n?.t(key, params) ?? key;
    },
  };
  return guardCommandApi(api);
}

export function setHostSceneId(state: CommandApiState, sceneId: SceneId | undefined): void {
  state.sceneId = sceneId;
}
