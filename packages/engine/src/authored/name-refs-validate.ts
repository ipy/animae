import type { Authored } from "../schema/authored.ts";
import type { ResolvedPolicy } from "../schema/policy.ts";
import { authoredFieldPlain } from "../entities/names.ts";
import { hasNameRefs, nameRefIds } from "../entities/name-refs.ts";
import type { WarnFn } from "./validate.ts";

function scanText(file: string, path: string, text: string, characterIds: Set<string>, warn: WarnFn): void {
  if (!text || !hasNameRefs(text)) return;
  for (const id of nameRefIds(text)) {
    if (!characterIds.has(id)) {
      warn("NAME_REF_UNKNOWN", `{{name:${id}}} references unknown character "${id}"`, { file, path, id });
    }
  }
}

function scanField(file: string, path: string, value: unknown, characterIds: Set<string>, warn: WarnFn): void {
  const text = authoredFieldPlain(value);
  if (text) scanText(file, path, text, characterIds, warn);
}

function characterIdSet(authored: Authored): Set<string> {
  const characterIds = new Set(Object.keys(authored.characters));
  characterIds.add("player");
  return characterIds;
}

function walkUnknownStrings(
  value: unknown,
  file: string,
  path: string,
  characterIds: Set<string>,
  warn: WarnFn,
): void {
  if (typeof value === "string") {
    scanText(file, path, value, characterIds, warn);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => walkUnknownStrings(v, file, `${path}[${i}]`, characterIds, warn));
    return;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      walkUnknownStrings(v, file, path ? `${path}.${k}` : k, characterIds, warn);
    }
  }
}

/** Warn on `{{name:<id>}}` markers that do not resolve to an authored character. */
export function warnUnknownNameRefs(authored: Authored, warn: WarnFn): void {
  const characterIds = characterIdSet(authored);

  for (const [id, char] of Object.entries(authored.characters)) {
    scanField(`characters/${id}/card.md`, "persona", char.persona, characterIds, warn);
    scanField(`characters/${id}/card.md`, "identity.summary", char.card.identity.summary, characterIds, warn);
    scanField(`characters/${id}/card.md`, "style", char.card.style, characterIds, warn);
    for (const [i, ex] of (char.card.identity.style_examples ?? []).entries()) {
      scanField(`characters/${id}/card.md`, `style_examples[${i}]`, ex, characterIds, warn);
    }
    for (const [i, m] of (char.card.constraints.motives ?? []).entries()) {
      scanField(`characters/${id}/card.md`, `motives[${i}]`, m, characterIds, warn);
    }
    for (const [i, line] of (char.card.constraints.bottom_lines ?? []).entries()) {
      scanField(`characters/${id}/card.md`, `bottom_lines[${i}]`, line.text, characterIds, warn);
    }
    for (const [i, rel] of char.relations.entries()) {
      scanField(`characters/${id}/card.md`, `relations[${i}].kind`, rel.kind, characterIds, warn);
    }
  }

  if (authored.world.rules_text) {
    scanField("world/world.yaml", "rules_text", authored.world.rules_text, characterIds, warn);
  }

  for (const doc of authored.knowledge) {
    scanField(doc.path, "body", doc.body, characterIds, warn);
    scanField(doc.path, "name", doc.name, characterIds, warn);
    scanField(doc.path, "description", doc.description, characterIds, warn);
  }

  for (const loc of Object.values(authored.locations)) {
    scanField(`world/locations/${loc.id}.yaml`, "description", loc.description, characterIds, warn);
    scanField(`world/locations/${loc.id}.yaml`, "summary", loc.summary, characterIds, warn);
    scanField(`world/locations/${loc.id}.yaml`, "name", loc.name, characterIds, warn);
  }

  for (const [tid, tpl] of Object.entries(authored.templates.character ?? {})) {
    scanField(`templates/character/${tid}`, "guidance", tpl.guidance, characterIds, warn);
  }
  for (const [tid, tpl] of Object.entries(authored.templates.location ?? {})) {
    scanField(`templates/location/${tid}`, "guidance", tpl.guidance, characterIds, warn);
  }
}

/** Policy overlays (`x.prompt`, tier directives, event descriptions). */
export function warnUnknownNameRefsInPolicy(policy: ResolvedPolicy, characterIds: Set<string>, warn: WarnFn): void {
  const x = policy.x;
  if (x?.prompt) walkUnknownStrings(x.prompt, "policies", "x.prompt", characterIds, warn);
  if (x?.tier_directives) walkUnknownStrings(x.tier_directives, "policies", "x.tier_directives", characterIds, warn);
  for (const [key, def] of Object.entries(policy.events?.types ?? {})) {
    scanField("policies", `events.types.${key}.description`, def.description, characterIds, warn);
  }
}

/** Locale string catalog entries (flattened keys). */
export function warnUnknownNameRefsInStrings(
  entries: Record<string, string>,
  characterIds: Set<string>,
  warn: WarnFn,
): void {
  for (const [key, text] of Object.entries(entries)) {
    scanText("locales", key, text, characterIds, warn);
  }
}
