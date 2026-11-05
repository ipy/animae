import { describe, expect, test } from "bun:test";
import { createLocaleOverlayStorage } from "../../src/i18n/locale-storage.ts";
import { testStorage } from "../helpers/storage.ts";

describe("createLocaleOverlayStorage yaml patch and read-only surface", () => {
  test("applies locale yaml patch over base document", async () => {
    const base = testStorage();
    await base.writeAtomic("world/world.yaml", "title: Base\ntags:\n  - a\n");
    await base.writeAtomic("locales/en/world/world.patch.yaml", "title: Patched\ntags:\n  $append: [b]\n");
    const overlay = createLocaleOverlayStorage({ base, localeChain: ["en"] });
    const text = await overlay.readText("world/world.yaml");
    expect(text).toContain("title: Patched");
    expect(text).toContain("- b");
  });

  test("readBytes encodes resolved text and writeAtomic is rejected", async () => {
    const base = testStorage();
    await base.writeAtomic("notes.txt", "hello");
    const overlay = createLocaleOverlayStorage({ base, localeChain: [] });
    const bytes = await overlay.readBytes("notes.txt");
    expect(new TextDecoder().decode(bytes!)).toBe("hello");
    await expect(overlay.writeAtomic("notes.txt", "x")).rejects.toThrow(/read-only/i);
    await expect(overlay.append("notes.txt", "x")).rejects.toThrow(/read-only/i);
  });

  test("stat uses overlay size when base stat is missing", async () => {
    const base = testStorage();
    await base.writeAtomic("world/world.yaml", "title: x\n");
    await base.writeAtomic("locales/en/world/world.yaml", "title: localized\n");
    const overlay = createLocaleOverlayStorage({ base, localeChain: ["en"] });
    const st = await overlay.stat("world/world.yaml");
    expect(st?.size).toBeGreaterThan(0);
    expect(st?.isDir).toBe(false);
  });
});
