import type { Catalog } from "../contracts.ts";
import type { Authored, CharacterDef, ItemDef, LocationDef } from "../schema/authored.ts";
import type { EngineState } from "../state.ts";

export function createCatalog(
  getAuthored: () => Authored,
  getGenerated: () => EngineState["generated"],
): Catalog {
  return {
    character(id: string): CharacterDef | undefined {
      return getAuthored().characters[id] ?? getGenerated().characters[id];
    },
    characters(): CharacterDef[] {
      const m = new Map<string, CharacterDef>();
      for (const c of Object.values(getAuthored().characters)) m.set(c.id, c);
      for (const c of Object.values(getGenerated().characters)) m.set(c.id, c);
      return [...m.values()].sort((a, b) => a.id.localeCompare(b.id));
    },
    location(id: string): LocationDef | undefined {
      return getAuthored().locations[id] ?? getGenerated().locations[id];
    },
    locations(): LocationDef[] {
      const m = new Map<string, LocationDef>();
      for (const l of Object.values(getAuthored().locations)) m.set(l.id, l);
      for (const l of Object.values(getGenerated().locations)) m.set(l.id, l);
      return [...m.values()].sort((a, b) => a.id.localeCompare(b.id));
    },
    item(id: string): ItemDef | undefined {
      return getAuthored().items[id] ?? getGenerated().items[id];
    },
    template(kind, id) {
      return getAuthored().templates[kind][id];
    },
    knowledge() {
      const docs = [...getAuthored().knowledge];
      for (const c of Object.values(getAuthored().characters)) docs.push(...c.knowledge);
      for (const c of Object.values(getGenerated().characters)) docs.push(...c.knowledge);
      return docs.sort((a, b) => a.id.localeCompare(b.id));
    },
  };
}
