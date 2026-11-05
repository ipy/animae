import { afterEach, expect, test } from "bun:test";
import { clearLocalePacks } from "@animae/i18n";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEngine } from "../../src/engine/create-engine.ts";
import { createScriptedModel } from "../../src/model/scripted.ts";
import type { PromptSegments } from "../../src/ports.ts";
import { FsStorage } from "../../src/store/fs.ts";
import { FR_TEST_LOCALE, registerFrenchTestPack } from "../helpers/locale-packs.ts";
import { e2ePreset, seedE2eAuthored } from "../e2e/fixture.ts";

const I18N = {
  locale: FR_TEST_LOCALE,
  promptLocale: FR_TEST_LOCALE,
  outputLocale: FR_TEST_LOCALE,
  contentLocale: FR_TEST_LOCALE,
  fallbackLocale: "en",
} as const;

// The e2e preset, except that the cue description is a late-bound key like authored games write it.
const basePolicy = e2ePreset.policies![0]!;
const preset = {
  ...e2ePreset,
  policies: [
    {
      ...basePolicy,
      doc: {
        ...(basePolicy.doc as Record<string, unknown>),
        cues: { types: { emotion: { args: { mood: { type: "string" } }, description: "$t:cue.emotion.description" } } },
        scene: { turnTaking: "addressed", autonomous: { maxExchangesPerPlayerTurn: 1, when: "true" } },
      },
    },
  ],
};

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

let offFrench: (() => void) | undefined;
afterEach(() => {
  offFrench?.();
  offFrench = undefined;
  clearLocalePacks();
});

test("an engine resolves late-bound prompt strings and lists names for another output language", async () => {
  offFrench = registerFrenchTestPack();
  const root = await mkdtemp(join(tmpdir(), "animae-prompt-display-"));
  try {
    const storage = FsStorage(root);
    await seedE2eAuthored(storage);
    await storage.writeAtomic(`locales/${FR_TEST_LOCALE}/characters/npc1/card.md`, overlayCard("Éléa"));
    await storage.writeAtomic(
      `locales/${FR_TEST_LOCALE}/strings.yaml`,
      "cue:\n  emotion:\n    description: Indice émotionnel\ncharacter:\n  npc1:\n    name: Éléa\n",
    );
    await storage.writeAtomic(
      "locales/en/strings.yaml",
      "cue:\n  emotion:\n    description: mood hint\ncharacter:\n  npc1:\n    name: Aria\n",
    );

    const renders: PromptSegments[] = [];
    const body = (req: { label?: string; segments: PromptSegments }) => {
      if (req.label === "appraise") {
        return { type: "chat", intensity: 0.5, sincerity: 0.9, claims: [], search_terms: [], tags: [], input_class: "normal" };
      }
      if (req.label === "reflect") return { summaries: [], goal_changes: [], new_claims: [] };
      renders.push(req.segments);
      return { text: "Hello.", cues: [{ type: "emotion", args: { mood: "warm" }, at: 0 }], intent_realized: "talk" };
    };
    const engine = await createEngine({
      root,
      ports: { storage },
      presets: [preset],
      models: { s1: createScriptedModel("pd/s1", body), s2: createScriptedModel("pd/s2", body) },
      modelMode: "record",
      seed: 42,
      sessionId: "prompt_display",
      i18n: I18N,
    });
    try {
      const sceneId = await engine.scene.start({ location: "tavern", participants: ["player", "npc1", "npc2"] });
      for await (const _ of engine.scene.turn({ sceneId, actor: "player", text: "hi", addressee: "npc1", outputLocale: "en" })) {
        /* drain */
      }
      for await (const _ of engine.scene.turn({ sceneId, actor: "player", text: "again", addressee: "npc1" })) {
        /* drain */
      }
    } finally {
      await engine.close();
    }

    // Each player turn is followed by one autonomous exchange: two replies per turn.
    expect(renders.length).toBe(4);
    const [english, englishAuto, french, frenchAuto] = renders;
    for (const r of renders) {
      expect(r!.static).toContain("emotion: Indice émotionnel");
      expect(r!.static).not.toContain("$t:");
    }
    expect(english!.static).toContain("Éléa → Aria");
    expect(french!.static).not.toContain("Éléa → Aria");
    expect(english!.user).toContain("Parlez uniquement en tant que Éléa");
    expect(english!.user).toContain("English (en)");
    expect(englishAuto!.user).toContain("English (en)");
    expect(french!.user).not.toContain("English (en)");
    expect(frenchAuto!.user).not.toContain("English (en)");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
