import type { SceneId, TurnId } from "../types.ts";

export function formatTurnId(n: number): TurnId {
  return `turn_${String(n).padStart(4, "0")}`;
}

export function formatSceneId(n: number): SceneId {
  return `scn_${String(n).padStart(4, "0")}`;
}
