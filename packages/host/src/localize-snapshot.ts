import { isI18nEnvelope, isI18nRef, localizeDeep, toI18nRef, type I18nRef } from "@animae/i18n";
import type { FormatParams } from "@animae/i18n";

type Translator = (key: string, params?: FormatParams) => string;

function wireText(value: unknown, t: Translator): { text: string; i18n?: I18nRef } {
  const ref = toI18nRef(value as never);
  if (ref) {
    const nsKey = ref.key.includes(":") ? ref.key : `host:${ref.key}`;
    return { text: t(nsKey, ref.params), i18n: ref };
  }
  if (typeof value === "string") return { text: value };
  return { text: String(value ?? "") };
}

/** Localize host snapshot fields for a viewer UI locale; preserves `i18n` for client re-binding. */
export function localizeSnapshot(state: Record<string, unknown>, t: Translator): Record<string, unknown> {
  const out = localizeDeep(structuredClone(state), (key, params) => {
    const k = key.includes(":") ? key : `host:${key}`;
    return t(k, params);
  }) as Record<string, unknown>;

  const transcript = state.transcript;
  if (Array.isArray(transcript)) {
    out.transcript = transcript.map((entry) => {
      if (!entry || typeof entry !== "object") return entry;
      const e = entry as Record<string, unknown>;
      const rawText = e.text;
      const { text, i18n } = wireText(rawText, t);
      const merged: Record<string, unknown> = { ...e, text };
      if (i18n) merged.i18n = i18n;
      else if (isI18nEnvelope(rawText) || isI18nRef(rawText)) {
        const ref = toI18nRef(rawText as never);
        if (ref) merged.i18n = ref;
      }
      return merged;
    });
  }

  const actions = state.actions;
  if (Array.isArray(actions)) {
    out.actions = actions.map((a) => {
      if (!a || typeof a !== "object") return a;
      const row = a as Record<string, unknown>;
      if (typeof row.label !== "string" && row.label !== undefined) {
        const { text, i18n } = wireText(row.label, t);
        return { ...row, label: text, ...(i18n ? { i18n: { ...i18n, field: "label" } } : {}) };
      }
      return row;
    });
  }

  if (typeof state.turnError === "string" || isI18nEnvelope(state.turnError) || isI18nRef(state.turnError)) {
    const { text, i18n } = wireText(state.turnError, t);
    out.turnError = text;
    if (i18n) out.turnErrorI18n = i18n;
  }

  return out;
}
