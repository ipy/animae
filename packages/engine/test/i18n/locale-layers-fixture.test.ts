import { expect, test } from "bun:test";
import { loadAuthored } from "../../src/authored/load.ts";
import { validateContentLocalePresence } from "../../src/i18n/validate-lanes.ts";
import { testStorage } from "../helpers/storage.ts";

async function seedLanternRoot(storage: ReturnType<typeof testStorage>): Promise<void> {
  await storage.writeAtomic(
    "animae.yaml",
    `seed: 3
i18n:
  locale: en
  promptLocale: zh-CN
  contentLocale: zh-CN
policies: []
`,
  );
  await storage.writeAtomic(
    "world/world.yaml",
    `title: lantern_demo
language: en
`,
  );
  await storage.writeAtomic(
    "world/locations/village.yaml",
    `id: village
name: $t:loc.village.name
summary: $t:loc.village.summary
`,
  );
  await storage.writeAtomic(
    "locales/en/strings.yaml",
    `loc:
  village:
    name: Lantern Village
    summary: Paper lanterns line the alleys.
`,
  );
  await storage.writeAtomic(
    "locales/zh-CN/strings.yaml",
    `loc:
  village:
    name: 灯节村
    summary: 纸灯笼挂满小巷。
`,
  );
  await storage.writeAtomic(
    "locales/zh-CN/world/locations/village.yaml",
    `summary: |
      LLM-facing place brief (zh-CN content lane).
`,
  );
}

test("neutral YAML + $t display keys + zh-CN content overlay", async () => {
  const s = testStorage();
  await seedLanternRoot(s);
  const authored = await loadAuthored(s, {
    liftDisplayStrings: true,
    validateDisplayLocaleChain: ["en", "zh-CN"],
  });
  expect(authored.localeWarnings).toBeUndefined();
  const name = authored.locations.village?.name as unknown;
  expect(name).toEqual({ i18n: { key: "loc.village.name" } });
  const contentWarnings = await validateContentLocalePresence(s, "zh-CN");
  expect(contentWarnings).toEqual([]);
});
