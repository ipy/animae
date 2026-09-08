import { createI18n } from "./create-i18n.ts";
import type { CreateI18nOptions, I18nInstance } from "./types.ts";

export type CreateTranslatorOptions = CreateI18nOptions & {
  /** namespace list merged into default lookup (first wins for bare keys) */
  namespaces?: readonly string[];
};

/**
 * Namespaced translator factory (alias of {@link createI18n} with optional namespace list).
 * Prefer `namespace:key` or dotted keys; `namespaces` sets search order for bare keys.
 */
export function createTranslator(opts: CreateTranslatorOptions): I18nInstance {
  const { namespaces, ...rest } = opts;
  const base = createI18n(rest);
  if (!namespaces?.length) return base;

  const chain = namespaces;
  return {
    ...base,
    t(key, params, o) {
      if (key.includes(":") || o?.ns) return base.t(key, params, o);
      for (const ns of chain) {
        if (base.has(key, { ns })) return base.t(key, params, { ns });
      }
      return base.t(key, params, o);
    },
    has(key, o) {
      if (key.includes(":") || o?.ns) return base.has(key, o);
      return chain.some((ns) => base.has(key, { ns }));
    },
  };
}
