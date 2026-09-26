import { describe, expect, test } from "bun:test";
import { createLocaleOverlayStorage } from "../../src/i18n/index.ts";
import { prepareModOverlay } from "../../src/mods/prepare.ts";
import { testStorage } from "../helpers/storage.ts";

const note = (body: string) => `---\nname: note\n---\n${body}\n`;

describe("content locale chain: the most preferred locale that localizes a path wins", () => {
  test("root overlays: the first tag wins over a later fallback that also has the file", async () => {
    const base = testStorage();
    await base.writeAtomic("world/knowledge/note.md", note("base"));
    await base.writeAtomic("locales/zh-CN/world/knowledge/note.md", note("zh"));
    await base.writeAtomic("locales/en/world/knowledge/note.md", note("en"));
    const zhFirst = createLocaleOverlayStorage({ base, localeChain: ["zh-CN", "en"] });
    expect(await zhFirst.readText("world/knowledge/note.md")).toContain("zh");
    expect(await zhFirst.readText("world/knowledge/note.md")).not.toContain("en\n");
    const enFirst = createLocaleOverlayStorage({ base, localeChain: ["en", "zh-CN"] });
    expect(await enFirst.readText("world/knowledge/note.md")).toContain("en");
    expect(await enFirst.readText("world/knowledge/note.md")).not.toContain("zh\n");
  });

  test("root overlays: a fallback fills the gap when the preferred locale lacks the file", async () => {
    const base = testStorage();
    await base.writeAtomic("world/knowledge/note.md", note("base"));
    await base.writeAtomic("locales/en/world/knowledge/note.md", note("en only"));
    const overlay = createLocaleOverlayStorage({ base, localeChain: ["zh-CN", "en"] });
    expect(await overlay.readText("world/knowledge/note.md")).toContain("en only");
  });

  test("root overlays: card appends of a fallback are not stacked onto the preferred locale", async () => {
    const base = testStorage();
    await base.writeAtomic("characters/mira/card.md", "---\nname: Mira\n---\nBase persona.\n");
    await base.writeAtomic("locales/zh-CN/characters/mira/card.append.md", "ZH extra.\n");
    await base.writeAtomic("locales/en/characters/mira/card.append.md", "EN extra.\n");
    const overlay = createLocaleOverlayStorage({ base, localeChain: ["zh-CN", "en"] });
    const text = (await overlay.readText("characters/mira/card.md")) ?? "";
    expect(text).toContain("ZH extra.");
    expect(text).not.toContain("EN extra.");
  });

  test("mod overlays follow the same precedence", async () => {
    const s = testStorage();
    await s.writeAtomic("animae.yaml", "seed: 1\nmods: [demo-mod]\n");
    await s.writeAtomic("mods/demo-mod/mod.yaml", "id: demo-mod\nname: Demo\nversion: 1.0.0\n");
    await s.writeAtomic("mods/demo-mod/world/knowledge/note.md", note("neutral"));
    await s.writeAtomic("mods/demo-mod/locales/zh-CN/world/knowledge/note.md", note("zh"));
    await s.writeAtomic("mods/demo-mod/locales/en/world/knowledge/note.md", note("en"));
    const zh = await prepareModOverlay(s, ["demo-mod"], { contentLocaleChain: ["zh-CN", "en"] });
    const zhText = (await zh.readStorage.readText("world/knowledge/note.md")) ?? "";
    expect(zhText).toContain("zh");
    expect(zhText).not.toContain("en\n");
    const en = await prepareModOverlay(s, ["demo-mod"], { contentLocaleChain: ["en", "zh-CN"] });
    expect(await en.readStorage.readText("world/knowledge/note.md")).toContain("en");
  });
});
