# @animae/i18n

Locale negotiation, an ICU MessageFormat subset, catalogs, locale packs, and hygiene helpers for the Animae packages. English is the reference language; every other language is a **locale pack** registered by the application.

```ts
import { createI18n, negotiateLocale, registerLocalePack } from "@animae/i18n";

// Ship a translation: partial packs are fine, missing keys fall back to English key by key.
registerLocalePack({ locale: "fr", catalogs: { tui: { "command.desc.help": "Afficher l'aide" } } });

const i18n = createI18n({
  locale: negotiateLocale({ env: process.env }),
  catalogs: { app: { en: { hello: "Hello, {name}" }, fr: { hello: "Bonjour, {name}" } } },
  defaultNamespace: "app",
});
i18n.t("hello", { name: "Ada" });
```

## What is in the package

| Export | Purpose |
|---|---|
| `createI18n`, `createTranslator`, `runWithLocale`, `scopedI18n` | translators bound to a locale, per request or per process |
| `negotiateLocale`, `buildFallbackChain`, `matchAvailableLocale`, `normalizeLocaleTag` | generic locale negotiation: tag, less specific tags, same-language sibling, `en` |
| `registerLocalePack`, `registeredLocales`, `localeCatalogs`, `localePacksVersion`, `clearLocalePacks`, `resolveCatalogLocale`, `LOCALE_NAMESPACES` | the locale-pack registry |
| `localizeValue`, `localizeDeep`, `localizeError`, `formatStructuredMessage` | late-bound text and structured messages |
| `applyPseudoLocale`, `isPseudoLocale` | pseudo-locale (`en-XA`, `xx-pseudo`) for QA |
| `runI18nCheck`, `findCjkStringLiterals` | catalog parity checks and a scan for hard-coded non-Latin string literals |
| `@animae/i18n/browser` | the browser-safe subset (no Node imports) |
| `@animae/i18n/react` | `I18nProvider`, `useT`, `useLocale`, `loadCatalogs` |

## Locale packs

A pack is `{ locale, catalogs }`; `catalogs` maps a namespace to a (nested or flat) message catalog. The namespaces the Animae packages read are listed in `LOCALE_NAMESPACES`: `errors`, `diagnostics`, `prompts`, `gallery-prompts`, `cli`, `tui`, `host`, `web`, `web-client`. Packs are kept in a process-global registry, read at use time by every package, so registration order against imports does not matter. A later registration wins per key, and a pack for `en` overrides the built-in English text.

Consumers expose their catalogs as getter objects (`localeCatalogs(namespace, builtIn)` merges the registered packs over the built-in catalogs), and use `localePacksVersion()` to invalidate caches built from them.

See [docs/i18n.md](../../docs/i18n.md) for the four locale settings, how to ship a translation package, authored string tables, and the web endpoints that serve client catalogs.

## Tests

```bash
bun test ./packages/i18n/test
```
