import type { Engine, SceneId } from "@animae/engine";

/** Minimal engine for `createHostCommandApi` UI-bridge tests; cast once at the boundary. */
export function createCommandApiBridgeTestEngine(): Engine {
  const engine = {
    scene: {
      active: () => null,
      start: async () => "scn_x" as SceneId,
      end: async () => {},
    },
  };
  return engine as unknown as Engine;
}
