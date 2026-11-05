import { describe, expect, test } from "bun:test";
import { createLocaleOverlayStorage } from "../../src/i18n/locale-storage.ts";
import { testStorage } from "../helpers/storage.ts";

describe("createLocaleOverlayStorage", () => {
  test("full locale file replaces base; patch merges yaml and markdown", async () => {
    const base = testStorage();
    await base.writeAtomic("world/world.yaml", "title: Base\ncount: 1\n");
    await base.writeAtomic("docs/readme.md", "---\ntitle: Base\n---\nBody.\n");
    await base.writeAtomic("locales/fr/world/world.yaml", "title: French\ncount: 2\n");
    await base.writeAtomic("locales/fr/docs/readme.patch.yaml", "title: Patched\n");
    await base.writeAtomic("locales/fr/characters/npc/card.append.md", "Appendix.\n");

    const overlay = createLocaleOverlayStorage({ base, localeChain: ["fr", "en"] });
    const yaml = await overlay.readText("world/world.yaml");
    expect(yaml).toContain("title: French");
    expect(yaml).toContain("count: 2");

    await base.writeAtomic("locales/en/world/world.yaml", "title: English\n");
    const enFirst = createLocaleOverlayStorage({ base, localeChain: ["en", "fr"] });
    expect(await enFirst.readText("world/world.yaml")).toContain("title: English");

    const frDoc = createLocaleOverlayStorage({ base, localeChain: ["fr"] });
    const md = await frDoc.readText("docs/readme.md");
    expect(md).toContain("title: Patched");
    expect(md).toContain("Body.");
  });

  test("readBytes and exists mirror readText; write is rejected", async () => {
    const base = testStorage();
    await base.writeAtomic("note.txt", "hello");
    await base.writeAtomic("locales/de/note.txt", "hallo");
    const overlay = createLocaleOverlayStorage({ base, localeChain: ["de"] });
    const bytes = await overlay.readBytes("note.txt");
    expect(new TextDecoder().decode(bytes!)).toBe("hallo");
    expect(await overlay.exists("note.txt")).toBe(true);
    expect(await overlay.exists("missing.txt")).toBe(false);
    await expect(overlay.writeAtomic("x", "y")).rejects.toThrow(/read-only/i);
    await expect(overlay.append("x", "y")).rejects.toThrow(/read-only/i);
    await expect(overlay.mkdir("x")).rejects.toThrow(/read-only/i);
    await expect(overlay.remove("x")).rejects.toThrow(/read-only/i);
  });

  test("stat uses overlay size; list hides locale paths from logical dirs", async () => {
    const base = testStorage();
    await base.writeAtomic("world/world.yaml", "title: x\n");
    await base.writeAtomic("locales/en/world/world.yaml", "title: longer overlay\n");
    const overlay = createLocaleOverlayStorage({ base, localeChain: ["en"] });
    const st = await overlay.stat("world/world.yaml");
    expect(st?.size).toBeGreaterThan(0);
    const files = await overlay.listFiles("");
    expect(files.some((p) => p.startsWith("locales/"))).toBe(false);
    expect(await overlay.list("locales")).toEqual(await base.list("locales"));
  });
});
