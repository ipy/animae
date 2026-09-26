import type { Kernel } from "../contracts.ts";
import { getPromptSection, type PromptSectionKey } from "../prompts/index.ts";
import { promptText } from "./prompt-text.ts";

/** Policy-declared id kinds whose display text may come from the game's string tables by naming convention. */
export type PolicyIdKind = "event" | "track" | "tier" | "approach" | "taboo";

export function prettifyId(id: string): string {
  return id
    .split(/[-_]/g)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function conventionText(k: Kernel, key: string): string {
  return k.displayText?.lookup(k.i18n.promptLocale, key)?.trim() ?? "";
}

/**
 * Text for a policy-declared id in the prompt language: the explicit `label`/`description` on the definition (plain or
 * late-bound `$t:`), else the conventional string-table entry `<kind>.<id>.<field>`. Empty when the game ships neither.
 * `tier` ids are looked up as `tier.<track>.<name>` first, then `tier.<name>`.
 */
export function policyText(
  k: Kernel,
  kind: PolicyIdKind,
  id: string,
  field: "label" | "description",
  explicit?: string,
  scope?: string,
): string {
  const own = explicit ? (promptText(k, explicit)?.trim() ?? "") : "";
  if (own) return own;
  if (kind === "tier" && scope) {
    const scoped = conventionText(k, `tier.${scope}.${id}.${field}`);
    if (scoped) return scoped;
  }
  return conventionText(k, `${kind}.${id}.${field}`);
}

/** Localized event type label + optional description for prompts (`label (description)`); the id when the game ships neither. */
export function eventTypePromptLine(k: Kernel, typeId: string): string {
  const def = k.policy.events.types[typeId];
  if (!def || typeId === "other") return "";
  const label = policyText(k, "event", typeId, "label", def.label) || prettifyId(typeId);
  const desc = policyText(k, "event", typeId, "description", def.description);
  const loc = k.i18n.promptLocale;
  if (desc) return getPromptSection(loc, "event_type_with_desc", { label, description: desc });
  return getPromptSection(loc, "event_type_label_only", { label });
}

/** One line of the event type list in the appraise prompt: `- id: label (description) [positive]`. */
export function appraiseTypeLine(k: Kernel, typeId: string): string {
  const def = k.policy.events.types[typeId];
  if (!def) return "";
  const loc = k.i18n.promptLocale;
  const label = policyText(k, "event", typeId, "label", def.label);
  const desc = policyText(k, "event", typeId, "description", def.description);
  const positive = def.positive ? getPromptSection(loc, "appraise_type_positive") : "";
  const text = label && desc && desc !== label ? getPromptSection(loc, "appraise_type_text", { label, description: desc }) : label || desc;
  if (!text || text === typeId) return getPromptSection(loc, "appraise_type_line_bare", { id: typeId, positive });
  return getPromptSection(loc, "appraise_type_line", { id: typeId, text, positive });
}

/** Localized intent label for render prompts (falls back to prettified id). */
export function intentPromptLabel(k: Kernel, intentId: string): string {
  const types = k.policy.intent?.types ?? [];
  if (!types.includes(intentId)) return prettifyId(intentId);
  const sectionKey = `intent_label_${intentId}` as PromptSectionKey;
  const fromSection = getPromptSection(k.i18n.promptLocale, sectionKey);
  if (fromSection && fromSection !== sectionKey) return fromSection;
  const key = `intent.${intentId}.label`;
  const fromCatalog = k.displayText?.lookup(k.i18n.promptLocale, key);
  if (fromCatalog?.trim()) return fromCatalog.trim();
  return prettifyId(intentId);
}
