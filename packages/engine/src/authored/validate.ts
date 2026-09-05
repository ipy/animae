import type { Authored, CharacterDef } from "../schema/authored.ts";
import type { ConfigIssue } from "./errors.ts";

export type WarnFn = (code: string, message: string, extra?: Record<string, unknown>) => void;

export function crossReferenceAuthored(authored: Authored, warn: WarnFn): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const locationIds = new Set(Object.keys(authored.locations));
  const fieldIds = new Set(Object.keys(authored.fields));
  const characterIds = new Set(Object.keys(authored.characters));

  for (const [id, loc] of Object.entries(authored.locations)) {
    for (const [i, c] of loc.connects.entries()) {
      if (!locationIds.has(c.to)) {
        issues.push({
          file: `world/locations/${id}.yaml`,
          path: `connects[${i}].to`,
          message: `unknown location "${c.to}"`,
        });
      }
    }
  }

  for (const anchor of authored.anchors) {
    for (const [i, ref] of anchor.refs.entries()) {
      if (!characterIds.has(ref) && !ref.startsWith("knowledge:")) {
        warn("ANCHOR_REF_UNKNOWN", `anchor ${anchor.id} refs unknown entity "${ref}"`, { anchor: anchor.id, ref });
      }
    }
    if (anchor.soft?.id && !fieldIds.has(anchor.soft.id) && anchor.soft.source === "author") {
      // inline field def is ok
    }
  }

  for (const beat of authored.beats) {
    for (const [i, fid] of beat.fields.entries()) {
      if (!fieldIds.has(fid)) {
        issues.push({
          file: "world/beats.yaml",
          path: `fields[${i}]`,
          message: `unknown field "${fid}"`,
        });
      }
    }
  }

  for (const char of Object.values(authored.characters)) {
    validateCharacterRelations(char, characterIds, warn);
  }

  const dupCheck = duplicateEntityIds(authored);
  issues.push(...dupCheck);

  return issues;
}

function duplicateEntityIds(authored: Authored): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const seen = new Map<string, string>();
  const add = (id: string, file: string) => {
    if (seen.has(id)) {
      issues.push({ file, path: "id", message: `duplicate id "${id}" (also used in ${seen.get(id)})` });
    } else seen.set(id, file);
  };
  for (const id of Object.keys(authored.locations)) add(id, `world/locations/${id}.yaml`);
  for (const id of Object.keys(authored.items)) add(id, `world/items/${id}.yaml`);
  for (const id of Object.keys(authored.fields)) add(id, `world/fields/${id}.yaml`);
  return issues;
}

function validateCharacterRelations(char: CharacterDef, characterIds: Set<string>, warn: WarnFn): void {
  for (const [i, rel] of char.relations.entries()) {
    if (!characterIds.has(rel.to)) {
      warn("RELATION_TARGET_MISSING", `character ${char.id} relation[${i}] target "${rel.to}" not found (may be generated later)`, {
        character: char.id,
        to: rel.to,
      });
    }
  }
}
