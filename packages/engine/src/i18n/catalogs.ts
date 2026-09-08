import { createI18n, type I18nInstance } from "@animae/i18n";
import enErrors from "../../locales/en/errors.json" with { type: "json" };
import zhErrors from "../../locales/zh-CN/errors.json" with { type: "json" };
import enDiagnostics from "../../locales/en/diagnostics.json" with { type: "json" };
import zhDiagnostics from "../../locales/zh-CN/diagnostics.json" with { type: "json" };

const engineCatalogs = {
  errors: { en: enErrors, "zh-CN": zhErrors },
  diagnostics: { en: enDiagnostics, "zh-CN": zhDiagnostics },
};

export function createEngineI18n(locale: string, fallbackChain: readonly string[]): I18nInstance {
  return createI18n({
    locale,
    fallbackChain,
    defaultNamespace: "errors",
    catalogs: engineCatalogs,
    dev: typeof process !== "undefined" && process.env?.NODE_ENV !== "production",
  });
}

export { engineCatalogs };
