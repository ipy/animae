import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEngine } from "../../src/engine/create-engine.ts";
import { createScriptedModel } from "../../src/model/scripted.ts";
import { FsStorage } from "../../src/store/fs.ts";
import { e2ePreset, seedE2eAuthored } from "../e2e/fixture.ts";

const I18N = { locale: "en", promptLocale: "fr", outputLocale: "en", contentLocale: "fr", fallbackLocale: "en" } as const;

function scriptedModels() {
  const body = (req: { label?: string }) => {
    if (req.label === "appraise") {
      return { type: "chat", intensity: 0.5, sincerity: 0.9, claims: [], search_terms: [], tags: [], input_class: "normal" };
    }
    if (req.label === "reflect") return { summaries: [], goal_changes: [], new_claims: [] };
    return { text: "Hello.", cues: [{ type: "emotion", args: { mood: "warm" }, at: 0 }], intent_realized: "talk" };
  };
  return { s1: createScriptedModel("hr/s1", body), s2: createScriptedModel("hr/s2", body) };
}

const overlayCard = (name: string) => `---
identity:
  id: npc1
  name: ${name}
tags: []
constraints:
  motives: []
  bottom_lines: []
  taboos: []
lod: principal
---
Persona for ${name}.
`;

async function talk(engine: Awaited<ReturnType<typeof createEngine>>, sceneId: string, text: string) {
  for await (const _ of engine.scene.turn({ sceneId, actor: "player", text, addressee: "npc1" })) {
    /* drain */
  }
}

test("hot reload keeps the locale overlay the session started with", async () => {
  const root = await mkdtemp(join(tmpdir(), "animae-hot-reload-locale-"));
  try {
    const storage = FsStorage(root);
    await seedE2eAuthored(storage);
    await storage.writeAtomic("locales/fr/characters/npc1/card.md", overlayCard("Overlay Aria"));

    const engine = await createEngine({
      root,
      ports: { storage },
      presets: [e2ePreset],
      models: scriptedModels(),
      modelMode: "record",
      seed: 42,
      sessionId: "hr_locale",
      i18n: I18N,
    });
    try {
      const nameOf = () => (engine.query("debug", "characters/npc1") as { identity?: { name?: string } }).identity?.name;
      const reloads = async () => (await engine.timeline.events({ kinds: ["config.reloaded"] })).length;
      expect(nameOf()).toBe("Overlay Aria");
      const bootReloads = await reloads();

      const sceneId = await engine.scene.start({ location: "tavern", participants: ["player", "npc1"] });
      await talk(engine, sceneId, "first turn");
      // Nothing on disk changed, so the turn must not look like a config change …
      expect(await reloads()).toBe(bootReloads);
      // … and the localized content stays in effect.
      expect(nameOf()).toBe("Overlay Aria");

      // A real edit is picked up by the next turn, still through the overlay.
      await storage.writeAtomic("world/world.yaml", `title: E2E edited
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
  gold: 5
`);
      await talk(engine, sceneId, "second turn");
      expect(await reloads()).toBe(bootReloads + 1);
      expect(nameOf()).toBe("Overlay Aria");
    } finally {
      await engine.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
