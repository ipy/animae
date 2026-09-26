import type { Kernel } from "../contracts.ts";
import { entityDisplayName } from "../entities/names.ts";
import { displayLanguageName, getPromptSection, type PromptSectionKey } from "../prompts/index.ts";
import type { PromptSegments } from "../ports.ts";
import type { Template } from "../schema/authored.ts";
import { prepareAuthoredProse } from "../pipeline/prompt-prose.ts";

function worldFactsBlock(k: Kernel): string {
  const prompt = k.policy.x?.prompt;
  const fromPolicy =
    prompt && typeof prompt === "object" && typeof (prompt as { world_facts?: unknown }).world_facts === "string"
      ? prepareAuthoredProse(k, (prompt as { world_facts: string }).world_facts)
      : "";
  const rules = fromPolicy || prepareAuthoredProse(k, k.authored.world.rules_text);
  if (!rules) return "";
  return getPromptSection(k.i18n.promptLocale, "generate_world_rules", { rules });
}

function collectExistingDisplayNames(k: Kernel, kind: "character" | "location" | "item"): string[] {
  if (kind === "character") {
    return k.catalog.characters().map((c) => entityDisplayName(k.timeline.state(), k.catalog, c.id));
  }
  if (kind === "location") {
    return k.catalog.locations().map((l) => prepareAuthoredProse(k, l.name));
  }
  const names: string[] = [];
  for (const i of Object.values(k.authored.items)) names.push(prepareAuthoredProse(k, i.name));
  for (const i of Object.values(k.timeline.state().generated.items)) names.push(prepareAuthoredProse(k, i.name));
  return names.filter(Boolean);
}

function hintsBlock(k: Kernel, hints: Record<string, unknown> | undefined): string {
  if (!hints || !Object.keys(hints).length) return "";
  const rows = Object.entries(hints)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, val]) => `- ${key}: ${String(val).trim()}`)
    .join("\n");
  return getPromptSection(k.i18n.promptLocale, "generate_hints", { rows });
}

export function buildEntityGeneratePrompt(
  k: Kernel,
  tpl: Template,
  r: { kind: "character" | "location" | "item"; template: string; hints?: Record<string, unknown> },
  language: string,
): PromptSegments {
  const loc = k.i18n.promptLocale;
  const outputLang = displayLanguageName(language, loc);
  const guidance = tpl.guidance ? prepareAuthoredProse(k, tpl.guidance) : "";
  const staticParts = [
    worldFactsBlock(k),
    getPromptSection(loc, "generate_output_language", { tag: language, outputLang }),
    guidance ? getPromptSection(loc, "generate_template_guidance", { guidance }) : "",
  ].filter(Boolean);

  const existingNames = collectExistingDisplayNames(k, r.kind as "character" | "location" | "item");
  const dynamicParts = [
    hintsBlock(k, r.hints),
    existingNames.length ? getPromptSection(loc, "generate_avoid_names", { names: existingNames.join(", ") }) : "",
  ].filter(Boolean);

  return {
    static: staticParts.join("\n\n"),
    semiStatic: "",
    dynamic: dynamicParts.join("\n\n"),
    user: getPromptSection(loc, "generate_user", {
      kindLabel: getPromptSection(loc, `generate_kind_${r.kind}` as PromptSectionKey),
      template: r.template,
    }),
  };
}

export function buildEntityPromotePrompt(
  k: Kernel,
  tpl: Template,
  defJson: string,
  from: string,
  to: string,
  language: string,
): PromptSegments {
  const loc = k.i18n.promptLocale;
  const outputLang = displayLanguageName(language, loc);
  const guidance = tpl.guidance ? prepareAuthoredProse(k, tpl.guidance) : "";
  const staticParts = [
    worldFactsBlock(k),
    getPromptSection(loc, "generate_output_language", { tag: language, outputLang }),
    guidance ? getPromptSection(loc, "generate_template_guidance", { guidance }) : "",
  ].filter(Boolean);

  return {
    static: staticParts.join("\n\n"),
    semiStatic: getPromptSection(loc, "promote_current_json", { json: defJson }),
    dynamic: getPromptSection(loc, "promote_dynamic", { from, to }),
    user: getPromptSection(loc, "promote_user", { to }),
  };
}
