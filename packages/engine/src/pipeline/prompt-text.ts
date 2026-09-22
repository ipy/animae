import type { Kernel } from "../contracts.ts";

const STRING_REF = /^\$t:([a-zA-Z0-9_.-]+)$/;

/**
 * Policy and authored strings may be late-bound (`$t:key`). A prompt is written in the working prompt language, so
 * resolve them there. Plain strings, and engines without string tables, pass through untouched. A key that no table
 * defines (an authoring error that `animae validate` reports) is dropped rather than leaking a placeholder into the
 * prompt.
 */
export function promptText(k: Kernel, value: string | undefined): string | undefined {
  if (!value || !k.displayText) return value;
  const { promptLocale, fallbackLocale } = k.i18n;
  const ref = STRING_REF.exec(value.trim());
  if (ref && ![promptLocale, fallbackLocale].some((locale) => k.displayText!.lookup(locale, ref[1]!) !== undefined)) {
    return undefined;
  }
  const resolved = k.displayText.resolve(promptLocale, value);
  return typeof resolved === "string" ? resolved : value;
}
