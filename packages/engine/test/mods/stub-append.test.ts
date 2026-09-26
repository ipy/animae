import { test, expect } from "bun:test";
import { testStorage } from "../helpers/storage.ts";
import { createLayeredStorage } from "../../src/mods/layered-storage.ts";
import { loadAuthored } from "../../src/authored/load.ts";
import { resolveMods } from "../../src/mods/resolve.ts";

async function seedMinimal(storage: ReturnType<typeof testStorage>): Promise<void> {
  await storage.writeAtomic("animae.yaml", "seed: 1\npolicies: []\nmods:\n  - demo\n");
  await storage.writeAtomic("world/world.yaml", "title: Base\nlanguage: en\n");
}

test("card.append stub comment is not merged into persona", async () => {
  const s = testStorage();
  await seedMinimal(s);
  await s.writeAtomic(
    "characters/alice/card.md",
    `---
identity:
  name: Alice
  summary: s
tags: []
constraints:
  motives: []
  bottom_lines: []
  taboos: []
lod: principal
---
Real persona body.
`,
  );
  await s.writeAtomic(
    "mods/demo/mod.yaml",
    `id: demo
name: Demo
version: 1.0.0
`,
  );
  await s.writeAtomic(
    "mods/demo/characters/alice/card.append.md",
    `---
{}
---
<!-- LLM body in mods/demo/locales/<locale>/ -->
`,
  );
  const { ordered, layers } = await resolveMods(s, ["demo"]);
  const layered = createLayeredStorage({ base: s, modLayers: layers });
  const authored = await loadAuthored(layered, { resolvedMods: ordered });
  expect(authored.characters.alice?.persona).toBe("Real persona body.");
  expect(authored.characters.alice?.persona).not.toContain("LLM body");
});
