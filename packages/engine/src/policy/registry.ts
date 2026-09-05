import type { PresetRegistry } from "../contracts.ts";
import type { PresetBundle } from "../preset.ts";
import { AnimaeError } from "../types.ts";

export function createPresetRegistry(initial?: PresetBundle[]): PresetRegistry {
  const map = new Map<string, PresetBundle>();
  for (const b of initial ?? []) map.set(b.id, b);
  return {
    get(id: string) {
      return map.get(id);
    },
    list() {
      return [...map.values()];
    },
    add(b: PresetBundle) {
      map.set(b.id, b);
    },
  };
}

/** Topological order: bases first, then dependents. Throws CONFIG_INVALID on cycle or missing preset. */
export function resolvePresetChain(registry: PresetRegistry, id: string): PresetBundle[] {
  const chain: PresetBundle[] = [];
  const visiting = new Set<string>();
  const done = new Set<string>();

  function visit(presetId: string): void {
    if (done.has(presetId)) return;
    if (visiting.has(presetId)) {
      throw new AnimaeError("CONFIG_INVALID", `preset extends cycle involving "${presetId}"`);
    }
    const bundle = registry.get(presetId);
    if (!bundle) {
      throw new AnimaeError("CONFIG_INVALID", `unknown preset "${presetId}"`);
    }
    visiting.add(presetId);
    for (const ext of bundle.extends) visit(ext);
    visiting.delete(presetId);
    done.add(presetId);
    chain.push(bundle);
  }

  visit(id);
  return chain;
}
