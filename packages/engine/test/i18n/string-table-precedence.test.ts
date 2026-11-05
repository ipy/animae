import { expect, test } from "bun:test";
import { StringTableCache } from "../../src/i18n/string-table-cache.ts";
import { testStorage } from "../helpers/storage.ts";

/**
 * A preset ships its player-facing text in one language (`en`); a game in another language adds its own table next to
 * its data. The game's table must win over the preset's text for the same key, and the preset's *fallback-locale* text
 * must never shadow the game's translation into the preferred locale.
 */
async function cache(): Promise<StringTableCache> {
  const storage = testStorage();
  await storage.writeAtomic("locales/fr/rule.strings.yaml", "base:\n  render:\n    refuse_1: \"Non, je ne peux pas.\"\n    only_game: \"Seulement le jeu.\"\n");
  await storage.writeAtomic("locales/en/rule.strings.yaml", "base:\n  render:\n    only_game_en: \"Only the game (en).\"\n");
  const presetStrings = {
    en: {
      "base.render.refuse_1": "I can't do that.",
      "base.render.respond_1": "I see.",
      "base.render.only_game_en": "Preset text for a key the game also defines.",
    },
    fr: { "base.render.respond_2": "Je vois (preset)." },
  };
  const strings = new StringTableCache(storage, "en", presetStrings);
  await strings.warm(["fr", "en"]);
  return strings;
}

test("the game's table in the preferred locale wins over the preset's fallback-locale text", async () => {
  const strings = await cache();
  expect(strings.t("fr", "base.render.refuse_1")).toBe("Non, je ne peux pas.");
  expect(strings.lookup("fr", "base.render.refuse_1")).toBe("Non, je ne peux pas.");
});

test("a key the game does not translate falls back to the preset's fallback-locale text", async () => {
  const strings = await cache();
  expect(strings.t("fr", "base.render.respond_1")).toBe("I see.");
  expect(strings.lookup("fr", "base.render.respond_1")).toBeUndefined();
});

test("the preset's table in the preferred locale is used when the game ships none for the key", async () => {
  const strings = await cache();
  expect(strings.t("fr", "base.render.respond_2")).toBe("Je vois (preset).");
});

test("within one locale the game's table wins over the preset's text", async () => {
  const strings = await cache();
  expect(strings.t("en", "base.render.only_game_en")).toBe("Only the game (en).");
  expect(strings.t("en", "base.render.refuse_1")).toBe("I can't do that.");
});

test("a key only the game ships resolves in its own locale", async () => {
  const strings = await cache();
  expect(strings.t("fr", "base.render.only_game")).toBe("Seulement le jeu.");
});
