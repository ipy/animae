import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEngine } from "../../src/engine/create-engine.ts";
import { createScriptedModel } from "../../src/model/scripted.ts";
import type { PromptSegments } from "../../src/ports.ts";
import { FsStorage } from "../../src/store/fs.ts";
import { e2ePreset, seedE2eAuthored } from "../e2e/fixture.ts";

const I18N = { locale: "zh-CN", promptLocale: "zh-CN", outputLocale: "zh-CN", contentLocale: "zh-CN", fallbackLocale: "en" } as const;

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
${name}的人设。
`;

test("an engine resolves late-bound prompt strings and lists names for another output language", async () => {
  const root = await mkdtemp(join(tmpdir(), "animae-prompt-display-"));
  try {
    const storage = FsStorage(root);
    await seedE2eAuthored(storage);
    await storage.writeAtomic("locales/zh-CN/characters/npc1/card.md", overlayCard("艾莉亚"));
    await storage.writeAtomic(
      "locales/zh-CN/strings.yaml",
      "cue:\n  emotion:\n    description: 情绪提示\ncharacter:\n  npc1:\n    name: 艾莉亚\n",
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
    const [english, englishAuto, chinese, chineseAuto] = renders;
    for (const r of renders) {
      // The working prompt is Chinese, so the cue description resolves in Chinese for every reply.
      expect(r!.static).toContain("emotion: 情绪提示");
      expect(r!.static).not.toContain("$t:");
    }
    // English narration is asked for English spellings of the names; Chinese narration needs no glossary.
    expect(english!.static).toContain("艾莉亚 → Aria");
    expect(chinese!.static).not.toContain("艾莉亚 → Aria");
    expect(english!.user).toContain("只以 艾莉亚 的身份与口吻发言");
    // The autonomous reply belongs to the player turn and is narrated in that turn's language, not the engine default.
    expect(english!.user).toContain("English (en)");
    expect(englishAuto!.user).toContain("English (en)");
    expect(chinese!.user).not.toContain("English (en)");
    expect(chineseAuto!.user).not.toContain("English (en)");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
