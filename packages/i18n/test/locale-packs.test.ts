import { afterEach, expect, test } from "bun:test";
import { createI18n } from "../src/create-i18n.ts";
import { matchAvailableLocale } from "../src/negotiate.ts";
import {
  clearLocalePacks,
  localeCatalogs,
  registerLocalePack,
  registeredLocales,
  resolveCatalogLocale,
} from "../src/locale-packs.ts";

afterEach(() => clearLocalePacks());

const builtIn = { en: { hello: "Hello", nested: { a: "A", b: "B" } } };

test("without packs the built-in catalogs are returned as they are", () => {
  expect(localeCatalogs("tui", builtIn)).toEqual({ en: builtIn.en });
  expect(registeredLocales()).toEqual([]);
});

test("a pack adds a locale to the namespaces it provides", () => {
  registerLocalePack({ locale: "fr", catalogs: { tui: { hello: "Bonjour" }, cli: { go: "Allez" } } });
  expect(registeredLocales()).toEqual(["fr"]);
  expect(registeredLocales("tui")).toEqual(["fr"]);
  expect(registeredLocales("web")).toEqual([]);
  expect(Object.keys(localeCatalogs("tui", builtIn)).sort()).toEqual(["en", "fr"]);
  expect(Object.keys(localeCatalogs("web", builtIn))).toEqual(["en"]);
});

test("packs of one locale merge key by key and the later registration wins", () => {
  registerLocalePack({ locale: "fr", catalogs: { tui: { hello: "Bonjour", nested: { a: "A-fr" } } } });
  registerLocalePack({ locale: "FR", catalogs: { tui: { nested: { b: "B-fr" }, hello: "Salut" } } });
  const fr = localeCatalogs("tui", builtIn).fr;
  expect(fr).toEqual({ hello: "Salut", nested: { a: "A-fr", b: "B-fr" } });
});

test("a pack for the built-in locale overrides single keys and keeps the rest", () => {
  registerLocalePack({ locale: "en", catalogs: { tui: { nested: { a: "Alpha" } } } });
  expect(localeCatalogs("tui", builtIn).en).toEqual({ hello: "Hello", nested: { a: "Alpha", b: "B" } });
});

test("registration can be undone", () => {
  const off = registerLocalePack({ locale: "de", catalogs: { tui: { hello: "Hallo" } } });
  expect(registeredLocales("tui")).toEqual(["de"]);
  off();
  expect(registeredLocales("tui")).toEqual([]);
  off();
});

test("registered packs are what createI18n translates with", () => {
  registerLocalePack({ locale: "pt-BR", catalogs: { tui: { hello: "Olá" } } });
  const catalogs = { tui: localeCatalogs("tui", builtIn) };
  const i18n = createI18n({ locale: "pt-PT", defaultNamespace: "tui", catalogs, dev: false });
  // pt-PT has no catalog: the closest variant of the language answers, then English.
  expect(i18n.t("hello")).toBe("Olá");
  expect(i18n.t("nested.a")).toBe("A");
});

test("resolveCatalogLocale picks the closest available locale and falls back to en", () => {
  expect(resolveCatalogLocale("pt", ["en", "pt-BR"])).toBe("pt-BR");
  expect(resolveCatalogLocale("pt-BR", ["en", "pt"])).toBe("pt");
  expect(resolveCatalogLocale("ja", ["en", "pt-BR"])).toBe("en");
  expect(matchAvailableLocale("ja", ["pt-BR"])).toBeUndefined();
});
