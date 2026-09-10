import type { FormatParams, JsonValue } from "./types.ts";

/** Player-facing text deferred until UI locale is known. */
export interface I18nRef {
  key: string;
  params?: Record<string, JsonValue>;
}

export type LocalizableValue =
  | string
  | { $t: string; params?: Record<string, JsonValue> }
  | { i18n: I18nRef };

export function isI18nRef(value: unknown): value is { $t: string; params?: Record<string, JsonValue> } {
  return (
    typeof value === "object" &&
    value !== null &&
    "$t" in value &&
    typeof (value as { $t: unknown }).$t === "string"
  );
}

export function isI18nEnvelope(value: unknown): value is { i18n: I18nRef } {
  return (
    typeof value === "object" &&
    value !== null &&
    "i18n" in value &&
    typeof (value as { i18n: unknown }).i18n === "object" &&
    (value as { i18n: I18nRef }).i18n !== null &&
    typeof (value as { i18n: I18nRef }).i18n.key === "string"
  );
}

export function toI18nRef(value: LocalizableValue): I18nRef | undefined {
  if (typeof value === "string") return undefined;
  if (isI18nRef(value)) return { key: value.$t, params: value.params };
  if (isI18nEnvelope(value)) return value.i18n;
  return undefined;
}

/** Resolve a single localizable leaf using catalog `t`. Plain strings pass through. */
export function localizeValue(
  value: unknown,
  t: (key: string, params?: FormatParams) => string,
): unknown {
  if (typeof value === "string") return value;
  const ref = toI18nRef(value as LocalizableValue);
  if (ref) return t(ref.key, ref.params);
  return value;
}

/** Deep-walk objects/arrays; localizes `$t` / `{ i18n }` leaves only. */
export function localizeDeep(
  value: unknown,
  t: (key: string, params?: FormatParams) => string,
): unknown {
  const localized = localizeValue(value, t);
  if (localized !== value) return localized;
  if (Array.isArray(value)) return value.map((v) => localizeDeep(v, t));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = localizeDeep(v, t);
    return out;
  }
  return value;
}
