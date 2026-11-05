import { createI18n, localeCatalogs, type I18nInstance } from "@animae/i18n";
import enErrors from "../../locales/en/errors.json" with { type: "json" };
import enDiagnostics from "../../locales/en/diagnostics.json" with { type: "json" };

/**
 * The engine's message catalogs by namespace and locale: the English ones it ships, with every locale pack registered
 * through `registerLocalePack` merged over them. Read at access time, so a pack registered after this module loaded is
 * seen by the next engine that is created.
 */
export const engineCatalogs = {
  get errors() {
    return localeCatalogs("errors", { en: enErrors });
  },
  get diagnostics() {
    return localeCatalogs("diagnostics", { en: enDiagnostics });
  },
};

export function createEngineI18n(locale: string, fallbackChain: readonly string[]): I18nInstance {
  return createI18n({
    locale,
    fallbackChain,
    defaultNamespace: "errors",
    catalogs: { errors: engineCatalogs.errors, diagnostics: engineCatalogs.diagnostics },
    dev: typeof process !== "undefined" && process.env?.NODE_ENV !== "production",
  });
}
