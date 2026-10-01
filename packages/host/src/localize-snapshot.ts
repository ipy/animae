import { isI18nEnvelope, isI18nRef, localizeDeep, toI18nRef, type I18nRef } from "@animae/i18n";
import type { FormatParams } from "@animae/i18n";

type Translator = (key: string, params?: FormatParams, opts?: { ns?: string }) => string;

/**
 * Optional catalog probe (`I18nInstance.has`). With it, namespaces are probed silently and only the one that owns
 * the key is translated, so a late-bound key never produces a missing-key warning for the namespaces it is not in.
 */
type KeyProbe = (key: string, opts?: { ns?: string }) => boolean;

function isMissingKeyMarker(result: string, ns: string, path: string): boolean {
  return result === `${ns}:${path}`;
}

/** True when `result` is the `<namespace>:<key>` marker a translator returns for a key it does not know. */
function isUnresolvedMarker(result: string, key: string): boolean {
  const colon = result.indexOf(":");
  if (colon <= 0) return false;
  return /^[a-z][a-z0-9_-]*$/.test(result.slice(0, colon)) && result.slice(colon + 1) === key;
}

/** Namespaces to try, in order, for a key without an explicit namespace: `undefined` is the translator default. */
function candidateNamespaces(key: string): Array<string | undefined> {
  const hostFirst = /^(?:header|command|role)\./.test(key);
  return hostFirst ? ["host", "strings", undefined] : ["strings", "host", undefined];
}

function humanizeKey(key: string): string {
  const tail = key.includes(".") ? key.slice(key.lastIndexOf(".") + 1) : key;
  return tail.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Resolve late-bound preset / host keys against the merged web catalogs: preset `strings`, host copy, then the
 * namespace the transport itself owns (for example `error.*`). A key nobody knows is shown humanized rather than as a
 * raw `<namespace>:<key>` marker.
 */
function translateRef(ref: I18nRef, t: Translator, has?: KeyProbe): string {
  const { key, params } = ref;
  if (key.includes(":")) return t(key, params);

  for (const ns of candidateNamespaces(key)) {
    if (has) {
      if (has(key, ns ? { ns } : undefined)) return ns ? t(key, params, { ns }) : t(key, params);
      continue;
    }
    const hit = ns ? t(key, params, { ns }) : t(key, params);
    if (ns ? !isMissingKeyMarker(hit, ns, key) : !isUnresolvedMarker(hit, key)) return hit;
  }
  return humanizeKey(key);
}

function looksUnresolved(text: string, ref: I18nRef): boolean {
  if (text === ref.key) return true;
  return /^(?:web|host|strings|game|common):[\w.-]+$/.test(text.trim());
}

/** Preset / host keys for `localizeDeep` (events, toasts) — not the Web UI default namespace. */
export function bindLocalizeTranslator(
  t: Translator,
  has?: KeyProbe,
): (key: string, params?: FormatParams) => string {
  return (key, params) => translateRef({ key, params: params as I18nRef["params"] }, t, has);
}

function wireText(value: unknown, t: Translator, has?: KeyProbe): { text: string; i18n?: I18nRef } {
  const ref = toI18nRef(value as never);
  if (ref) {
    const text = translateRef(ref, t, has);
    return looksUnresolved(text, ref) ? { text, i18n: ref } : { text };
  }
  if (typeof value === "string") return { text: value };
  return { text: String(value ?? "") };
}

/** Localize host snapshot fields for a viewer UI locale; preserves `i18n` for client re-binding. */
export function localizeSnapshot(
  state: Record<string, unknown>,
  t: Translator,
  has?: KeyProbe,
): Record<string, unknown> {
  const lt = bindLocalizeTranslator(t, has);
  const out = localizeDeep(structuredClone(state), lt) as Record<string, unknown>;

  const transcript = state.transcript;
  if (Array.isArray(transcript)) {
    out.transcript = transcript.map((entry) => {
      if (!entry || typeof entry !== "object") return entry;
      const e = entry as Record<string, unknown>;
      const rawText = e.text;
      const { text, i18n } = wireText(rawText, t, has);
      const merged: Record<string, unknown> = { ...e, text };
      if (i18n) merged.i18n = i18n;
      else delete merged.i18n;
      return merged;
    });
  }

  const actions = state.actions;
  if (Array.isArray(actions)) {
    out.actions = actions.map((a) => {
      if (!a || typeof a !== "object") return a;
      const row = a as Record<string, unknown>;
      const next: Record<string, unknown> = { ...row };
      for (const field of ["label", "hint"] as const) {
        const raw = row[field];
        if (typeof raw !== "string" && raw !== undefined) {
          const { text, i18n } = wireText(raw, t, has);
          next[field] = text;
          if (i18n) next[`${field}I18n`] = { ...i18n, field };
        }
      }
      const args = row.args;
      if (Array.isArray(args)) {
        next.args = args.map((argRow) => {
          if (!argRow || typeof argRow !== "object") return argRow;
          const ar = argRow as Record<string, unknown>;
          const argOut: Record<string, unknown> = { ...ar };
          if (typeof ar.label !== "string" && ar.label !== undefined) {
            const { text, i18n } = wireText(ar.label, t, has);
            argOut.label = text;
            if (i18n) argOut.labelI18n = i18n;
          }
          const opts = ar.options;
          if (Array.isArray(opts)) {
            argOut.options = opts.map((opt) => {
              if (!opt || typeof opt !== "object") return opt;
              const o = opt as Record<string, unknown>;
              if (typeof o.label !== "string" && o.label !== undefined) {
                const { text, i18n } = wireText(o.label, t, has);
                return { ...o, label: text, ...(i18n ? { labelI18n: i18n } : {}) };
              }
              return o;
            });
          }
          return argOut;
        });
      }
      return next;
    });
  }

  if (typeof state.turnError === "string" || isI18nEnvelope(state.turnError) || isI18nRef(state.turnError)) {
    const { text, i18n } = wireText(state.turnError, t, has);
    out.turnError = text;
    if (i18n) out.turnErrorI18n = i18n;
  }

  return out;
}
