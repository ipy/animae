import { afterEach, describe, expect, test } from "bun:test";
import { clearLocalePacks } from "@animae/i18n";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEngine } from "../../src/engine/create-engine.ts";
import { FsStorage } from "../../src/store/fs.ts";
import { FR_TEST_LOCALE, registerFrenchTestPack } from "../helpers/locale-packs.ts";
import { lifecyclePreset, openSessionEngine, playTurn, streamingLifecycleLlm } from "./session-fixture.ts";
import { seedE2eAuthored } from "./fixture.ts";

const I18N = {
  locale: "en",
  promptLocale: FR_TEST_LOCALE,
  outputLocale: "en",
  contentLocale: FR_TEST_LOCALE,
  fallbackLocale: "en",
} as const;

let offFrench: (() => void) | undefined;
afterEach(() => {
  offFrench?.();
  offFrench = undefined;
  clearLocalePacks();
});

describe("session i18n", () => {
  test("setUiLocale, outputLocale on turn, config.reloaded on hot reload", async () => {
    offFrench = registerFrenchTestPack();
    const llm = streamingLifecycleLlm();
    const h = await openSessionEngine({
      preset: lifecyclePreset(),
      models: { s1: llm.s1, s2: llm.s2 },
      i18n: I18N,
      sessionId: "sess_i18n",
    });
    try {
      const { engine, storage } = h;
      await storage.writeAtomic(
        `locales/${FR_TEST_LOCALE}/characters/npc1/card.md`,
        `---
identity:
  id: npc1
  name: Éléa
tags: []
constraints:
  motives: []
  bottom_lines: []
  taboos: []
lod: principal
---
Persona.
`,
      );
      await engine.reload();
      const reloads = async () => (await engine.timeline.events({ kinds: ["config.reloaded"] })).length;
      const bootReloads = await reloads();
      expect(engine.info().contentLocale).toBe(FR_TEST_LOCALE);

      engine.setUiLocale("fr");
      expect(engine.info().locale).toBe("fr");
      expect(engine.display.entityDisplayName("npc1", { locale: FR_TEST_LOCALE })).toBe("Éléa");

      const sceneId = await engine.scene.start({ location: "tavern", participants: ["player", "npc1"] });
      await playTurn(engine, sceneId, "bonjour", { outputLocale: "fr" });
      expect(await reloads()).toBe(bootReloads);

      await storage.writeAtomic(
        "world/world.yaml",
        `title: E2E
language: en
player: player
start_location: tavern
calendar:
  sceneMinutes: 5
  turnMinutes: 1
start:
  day: 1
  minute: 480
vars:
  gold: 6
`,
      );
      await playTurn(engine, sceneId, "second");
      expect(await reloads()).toBe(bootReloads + 1);
      const reloaded = (await engine.timeline.events({ kinds: ["config.reloaded"] })).at(-1);
      expect(reloaded?.kind).toBe("config.reloaded");

      await engine.scene.end(sceneId);
      await h.audit({ snapshots: false });
    } finally {
      await h.dispose();
    }
  });

  test("hot reload failure keeps prior locale overlay", async () => {
    offFrench = registerFrenchTestPack();
    const root = await mkdtemp(join(tmpdir(), "animae-session-i18n-fail-"));
    try {
      const storage = FsStorage(root);
      await seedE2eAuthored(storage);
      const llm = streamingLifecycleLlm();
      const engine = await createEngine({
        root,
        ports: { storage },
        presets: [lifecyclePreset()],
        models: { s1: llm.s1, s2: llm.s2 },
        i18n: I18N,
        sessionId: "sess_i18n_fail",
      });
      try {
        expect(engine.info().language).toBe("en");
        await storage.remove("world/locations/tavern.yaml");
        await storage.writeAtomic("world/locations/broken.yaml", "id: broken\n");
        const r = await engine.reload();
        expect(r.ok).toBe(false);
        expect(engine.info().language).toBe("en");
      } finally {
        await engine.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
