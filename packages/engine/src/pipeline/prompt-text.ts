import type { Kernel } from "../contracts.ts";
import { expandNameRefs } from "../entities/name-refs.ts";
import type { DisplayNameOptions } from "../entities/names.ts";

const STRING_REF = /^\$t:([a-zA-Z0-9_.-]+)$/;

/**
 * Policy and authored strings may be late-bound (`$t:key`). A prompt is written in the working prompt language, so
 * resolve them there, then expand `{{name:<id>}}` markers. Plain strings, and engines without string tables, pass
 * through untouched. A key that no table defines (an authoring error that `animae validate` reports) is dropped rather
 * than leaking a placeholder into the prompt.
 */
export function promptText(k: Kernel, value: string | undefined, opts?: DisplayNameOptions): string | undefined {
  if (!value) return value;
  let out = value;
  if (k.displayText) {
    const { promptLocale, fallbackLocale } = k.i18n;
    const ref = STRING_REF.exec(value.trim());
    if (ref && ![promptLocale, fallbackLocale].some((locale) => k.displayText!.lookup(locale, ref[1]!) !== undefined)) {
      return undefined;
    }
    const resolved = k.displayText.resolve(promptLocale, value);
    out = typeof resolved === "string" ? resolved : value;
  }
  if (!out.includes("{{")) return out;
  return expandNameRefs(out, { state: k.timeline.state(), catalog: k.catalog }, opts);
}
