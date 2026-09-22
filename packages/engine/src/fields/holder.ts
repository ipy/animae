import type { FieldDef } from "../schema/authored.ts";
import type { EngineState } from "../state.ts";
import type { CharacterId } from "../types.ts";

export interface SceneSlice {
  id: string;
  location: string;
  participants: CharacterId[];
}

/**
 * Holder involvement: a field applies only when its holder is involved in the current scene.
 * - character: holder.ref is a scene participant
 * - location: holder.ref equals the scene location (or player location when no scene)
 * - item: the item is held by a scene participant
 * - time / world / external: always involved when scope matches (global modifiers)
 */
export function holderInvolved(def: FieldDef, scene: SceneSlice | undefined, state: Readonly<EngineState>): boolean {
  const h = def.holder;
  switch (h.kind) {
    case "character":
      if (!h.ref) return false;
      if (scene) return scene.participants.includes(h.ref);
      return h.ref in state.characters;
    case "location": {
      if (!h.ref) return false;
      if (scene) return scene.location === h.ref;
      return (state.playerLocation ?? "") === h.ref;
    }
    case "item": {
      if (!h.ref) return false;
      const item = state.items[h.ref];
      if (!item?.holder) return false;
      if (item.holder.kind !== "character" || !item.holder.ref) return false;
      const carrier = item.holder.ref;
      if (scene) return scene.participants.includes(carrier);
      return carrier in state.characters;
    }
    case "time":
    case "world":
    case "external":
      return true;
    default:
      return false;
  }
}
