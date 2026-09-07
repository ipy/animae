import type { Engine, Viewer } from "@animae/engine";
import type { SceneId } from "@animae/engine";
import type { HostCommandApi } from "./types.ts";

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
): HostCommandApi {
  return {
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
    notify,
  };
}

export function setHostSceneId(state: CommandApiState, sceneId: SceneId | undefined): void {
  state.sceneId = sceneId;
}
