import { describe, expect, test } from "bun:test";
import { createLocaleOverlayStorage } from "../../src/i18n/index.ts";
import { prepareModOverlay } from "../../src/mods/prepare.ts";
import { testStorage } from "../helpers/storage.ts";

const note = (body: string) => `---\nname: note\n---\n${body}\n`;

describe("content locale chain: the most preferred locale that localizes a path wins", () => {
  test("root overlays: the first tag wins over a later fallback that also has the file", async () => {
    const base = testStorage();
    await base.writeAtomic("world/knowledge/note.md", note("base"));
    await base.writeAtomic("locales/fr/world/knowledge/note.md", note("fr-body"));
    await base.writeAtomic("locales/en/world/knowledge/note.md", note("en"));
    const frFirst = createLocaleOverlayStorage({ base, localeChain: ["fr", "en"] });
    expect(await frFirst.readText("world/knowledge/note.md")).toContain("fr-body");
    expect(await frFirst.readText("world/knowledge/note.md")).not.toContain("en\n");
    const enFirst = createLocaleOverlayStorage({ base, localeChain: ["en", "fr"] });
    expect(await enFirst.readText("world/knowledge/note.md")).toContain("en");
    expect(await enFirst.readText("world/knowledge/note.md")).not.toContain("fr-body\n");
  });

  test("root overlays: a fallback fills the gap when the preferred locale lacks the file", async () => {
    const base = testStorage();
    await base.writeAtomic("world/knowledge/note.md", note("base"));
    await base.writeAtomic("locales/en/world/knowledge/note.md", note("en only"));
    const overlay = createLocaleOverlayStorage({ base, localeChain: ["fr", "en"] });
    expect(await overlay.readText("world/knowledge/note.md")).toContain("en only");
  });

  test("root overlays: card appends of a fallback are not stacked onto the preferred locale", async () => {
    const base = testStorage();
    await base.writeAtomic("characters/mira/card.md", "---\nname: Mira\n---\nBase persona.\n");
    await base.writeAtomic("locales/fr/characters/mira/card.append.md", "FR extra.\n");
    await base.writeAtomic("locales/en/characters/mira/card.append.md", "EN extra.\n");
    const overlay = createLocaleOverlayStorage({ base, localeChain: ["fr", "en"] });
    const text = (await overlay.readText("characters/mira/card.md")) ?? "";
    expect(text).toContain("FR extra.");
    expect(text).not.toContain("EN extra.");
  });

  test("mod overlays follow the same precedence", async () => {
    const s = testStorage();
    await s.writeAtomic("animae.yaml", "seed: 1\nmods: [demo-mod]\n");
    await s.writeAtomic("mods/demo-mod/mod.yaml", "id: demo-mod\nname: Demo\nversion: 1.0.0\n");
    await s.writeAtomic("mods/demo-mod/world/knowledge/note.md", note("neutral"));
    await s.writeAtomic("mods/demo-mod/locales/fr/world/knowledge/note.md", note("fr-body"));
    await s.writeAtomic("mods/demo-mod/locales/en/world/knowledge/note.md", note("en"));
    const fr = await prepareModOverlay(s, ["demo-mod"], { contentLocaleChain: ["fr", "en"] });
    const frText = (await fr.readStorage.readText("world/knowledge/note.md")) ?? "";
    expect(frText).toContain("fr-body");
    expect(frText).not.toContain("en\n");
    const en = await prepareModOverlay(s, ["demo-mod"], { contentLocaleChain: ["en", "fr"] });
    expect(await en.readStorage.readText("world/knowledge/note.md")).toContain("en");
  });
});
