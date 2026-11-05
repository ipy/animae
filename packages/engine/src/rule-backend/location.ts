import type { Kernel } from "../contracts.ts";
import { authoredFieldPlain } from "../entities/names.ts";

/** The `location` CEL variable of a rule-backend template: id, display name and summary in the output language. */
export interface LocationVar {
  id: string;
  name: string;
  summary: string;
}

/**
 * Resolves a location for template use. Authored names may be `$t:key` references or `{ i18n }` fields; they resolve
 * in the language of player-facing text (`locale`), because rule-backend output is shown to the player as written.
 */
export function locationVar(k: Kernel, id: string | null | undefined, locale: string = k.i18n.outputLocale): LocationVar {
  if (!id) return { id: "", name: "", summary: "" };
  const loc = k.catalog.location(id);
  const show = (value: unknown): string => {
    if (value === undefined || value === null) return "";
    const resolved = k.displayText ? k.displayText.resolve(locale, value, { localizeNames: false }) : value;
    return (typeof resolved === "string" ? resolved : authoredFieldPlain(resolved)).trim();
  };
  return { id, name: show(loc?.name) || id, summary: show(loc?.summary) };
}
