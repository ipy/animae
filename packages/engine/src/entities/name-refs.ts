import type { Catalog } from "../contracts.ts";
import type { EngineState } from "../state.ts";
import type { CharacterId } from "../types.ts";
import { entityDisplayName, type DisplayNameOptions } from "./names.ts";

/**
 * Name references: authored text that has to mention a character writes `{{name:<character id>}}` instead of the
 * literal name. The reference resolves to the entity's current display name (a runtime nickname set with
 * `engine.setAlias` wins over the card name), so a player who renames the protagonist, or a renamed companion, is
 * never contradicted by prose written for the default name.
 *
 * The bare `{{name}}` / `{{nickname}}` / `{{canonical_name}}` template variables used inside policy prompt blocks are a
 * different mechanism and are not matched here.
 */
const NAME_REF_SOURCE = String.raw`\{\{\s*name\s*:\s*([A-Za-z0-9][A-Za-z0-9_-]*)\s*\}\}`;

/** A fresh global matcher for name reference markers (group 1 = character id). Never share one instance: `g` regexes are stateful. */
export function nameRefPattern(): RegExp {
  return new RegExp(NAME_REF_SOURCE, "g");
}

/** The slice of kernel state a reference needs. `Kernel` satisfies it structurally via `timeline.state()` and `catalog`. */
export interface NameRefView {
  state: Readonly<EngineState>;
  catalog: Catalog;
}

/** Character ids referenced by `{{name:<id>}}` markers in `text`, in order of first appearance. */
export function nameRefIds(text: string): CharacterId[] {
  if (!text.includes("{{")) return [];
  const seen = new Set<CharacterId>();
  for (const m of text.matchAll(nameRefPattern())) seen.add(m[1]!);
  return [...seen];
}

/** True when `text` contains at least one name reference marker. */
export function hasNameRefs(text: string): boolean {
  return text.includes("{{") && new RegExp(NAME_REF_SOURCE).test(text);
}

/**
 * Replaces every `{{name:<id>}}` marker with the entity's display name. A reference to an unknown id resolves to the
 * id itself (the same fallback `entityDisplayName` uses) so a typo never leaks marker syntax into a prompt or the UI;
 * `animae validate` reports such references up front.
 */
export function expandNameRefs(text: string, view: NameRefView, opts?: DisplayNameOptions): string {
  if (!text.includes("{{")) return text;
  return text.replace(nameRefPattern(), (_whole, id: string) => entityDisplayName(view.state, view.catalog, id, opts));
}
