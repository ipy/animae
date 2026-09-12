import { expect, test } from "bun:test";
import { createLocaleOverlayStorage, loadStringTables } from "../../src/i18n/index.ts";
import { createLayeredStorage } from "../../src/mods/layered-storage.ts";
import { testStorage } from "../helpers/storage.ts";

test("locale overlay storage lists locales/* for string table discovery", async () => {
  const base = testStorage();
  await base.writeAtomic("locales/en/base.strings.yaml", "hello: world\n");
  await base.writeAtomic("world/world.yaml", "title: x\n");
  const overlay = createLocaleOverlayStorage({ base, localeChain: ["en"] });
  const listed = await overlay.listFiles("locales/en");
  expect(listed).toContain("locales/en/base.strings.yaml");
  const resolver = await loadStringTables(overlay, ["en"]);
  expect(resolver.resolve("hello")).toBe("world");
});

test("layered mod storage merges base listFiles for locale tables", async () => {
  const base = testStorage();
  await base.writeAtomic("locales/en/base.strings.yaml", "k: v\n");
  await base.writeAtomic("world/world.yaml", "title: t\n");
  const layered = createLayeredStorage({ base, modLayers: [] });
  const listed = await layered.listFiles("locales/en");
  expect(listed.some((p) => p.endsWith("base.strings.yaml"))).toBe(true);
  const resolver = await loadStringTables(layered, ["en"]);
  expect(resolver.resolve("k")).toBe("v");
});
