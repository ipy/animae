import type { Kernel } from "../contracts.ts";
import { displayLanguageName, getPromptSection } from "../prompts/index.ts";
import type { PromptSegments } from "../ports.ts";
import { prepareAuthoredProse } from "../pipeline/prompt-prose.ts";

/** Offscreen location trace narration prompt (catalog scaffolding, display name only). */
export function buildNarrateLocationPrompt(k: Kernel, locationId: string): PromptSegments {
  const loc = k.catalog.location(locationId);
  const place = loc ? prepareAuthoredProse(k, loc.name) || prepareAuthoredProse(k, loc.summary) : locationId;
  const desc = loc?.description ? prepareAuthoredProse(k, loc.description) : loc?.summary ? prepareAuthoredProse(k, loc.summary) : "";
  const lang = k.i18n.outputLocale ?? k.authored.world.language ?? "en";
  const ploc = k.i18n.promptLocale;
  const outputLang = displayLanguageName(lang, ploc);
  const time = k.timeline.state().time;
  const timeLine = getPromptSection(ploc, "narrate_time", { day: time.day, minute: time.minute });

  const elsewhere = k.catalog
    .characters()
    .filter((c) => {
      const st = k.timeline.state().characters[c.id];
      return st?.location && st.location !== locationId && c.id !== "player";
    })
    .slice(0, 6)
    .map((c) => prepareAuthoredProse(k, c.card.identity.name))
    .filter(Boolean);
  const elsewhereLine = elsewhere.length
    ? getPromptSection(ploc, "narrate_elsewhere", { names: elsewhere.join(", ") })
    : "";

  return {
    static: getPromptSection(ploc, "narrate_static", { place, outputLang, tag: lang }),
    semiStatic: [desc ? getPromptSection(ploc, "narrate_place_detail", { detail: desc }) : "", timeLine, elsewhereLine]
      .filter(Boolean)
      .join("\n\n"),
    dynamic: getPromptSection(ploc, "narrate_dynamic"),
    user: getPromptSection(ploc, "narrate_user"),
  };
}
