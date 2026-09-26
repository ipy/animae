import type { Engine, Viewer } from "@animae/engine";
import type { SceneId } from "@animae/engine";
import { guardCommandApi } from "./command-api-contract.ts";
import type { HostCommandApi, HostCommandUiBridge } from "./types.ts";

export interface CommandApiState {
  sceneId?: string;
  sceneParticipants?: string[];
}

/**
 * Align the host's cached scene with the engine's. The scene is engine state, and `timeline.load` / `rewind` /
 * `switch` / `import` replace it behind the host's back, so a cached id would otherwise go stale and every later
 * turn / end-scene call would fail with `SCENE_INVALID`. Engines that do not implement `scene.active` (test doubles,
 * thin RPC proxies) keep the cached value.
 */
export function syncSceneFromEngine(engine: Engine, state: CommandApiState, actor: string): void {
  const probe = engine.scene.active;
  if (typeof probe !== "function") return;
  const open = probe.call(engine.scene);
  if (!open) {
    state.sceneId = undefined;
    state.sceneParticipants = undefined;
    return;
  }
  if (state.sceneId !== open.id) {
    state.sceneId = open.id;
    state.sceneParticipants = open.participants.filter((p) => p !== actor);
  }
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
  openFile?: (path: string) => void | Promise<void>,
): HostCommandApi {
  const api: HostCommandApi = {
    engine,
    viewer,
    actor,
    sceneId() {
      syncSceneFromEngine(engine, state, actor);
      return state.sceneId;
    },
    async startScene(s) {
      const id = await engine.scene.start(s);
      state.sceneId = id;
      state.sceneParticipants = s.participants.filter((p) => p !== actor);
      return id;
    },
    async endScene() {
      syncSceneFromEngine(engine, state, actor);
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
    openFile,
  };
  return guardCommandApi(api);
}

export function setHostSceneId(state: CommandApiState, sceneId: SceneId | undefined): void {
  state.sceneId = sceneId;
}
