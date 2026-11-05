import { expect, test } from "bun:test";
import { prepareModOverlay } from "../../src/mods/prepare.ts";
import { testStorage } from "../helpers/storage.ts";

test("mod locales overlay mod-owned paths after mod layer", async () => {
  const s = testStorage();
  await s.writeAtomic(
    "animae.yaml",
    `seed: 1
mods: [demo-mod]
`,
  );
  await s.writeAtomic("mods/demo-mod/mod.yaml", "id: demo-mod\nname: Demo\nversion: 1.0.0\n");
  await s.writeAtomic("mods/demo-mod/world/knowledge/note.md", "---\nname: base\n---\nBase EN body.\n");
  await s.writeAtomic(
    "mods/demo-mod/locales/fr/world/knowledge/note.md",
    "---\nname: base\n---\nCorps en francais.\n",
  );
  const { readStorage } = await prepareModOverlay(s, ["demo-mod"], { contentLocaleChain: ["fr", "en"] });
  const text = await readStorage.readText("world/knowledge/note.md");
  expect(text).toContain("Corps en francais");
});
