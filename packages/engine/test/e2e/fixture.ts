import type { StoragePort } from "../../src/ports.ts";
import type { PresetBundle } from "../../src/preset.ts";

const card = (id: string, name: string) => `---
identity:
  id: ${id}
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

export const e2ePreset: PresetBundle = {
  id: "e2e",
  extends: [],
  policies: [
    {
      name: "e2e-base.yaml",
      doc: {
        events: {
          types: {
            chat: { positive: true },
            care: { positive: true },
            other: { positive: false },
          },
        },
        tracks: {
          affinity: {
            scope: "relation",
            min: 0,
            max: 100,
            initial: 50,
            tiers: [
              { name: "distant", from: 0 },
              { name: "close", from: 60 },
            ],
            hysteresis: 5,
          },
          mood: { scope: "self", min: 0, max: 100, initial: 50, tiers: [], hysteresis: 0 },
        },
        rules: {
          delta_table: { chat: { affinity: 2 }, care: { affinity: 5, mood: 3 } },
          marginal: { k: 0.15, halfLifeHours: 24 },
          turn_cap: { affinity: 10 },
        },
        intent: { types: ["talk", "listen"] },
        intent_rules: [
          { intent: "talk", when: "true", score: 2 },
          { intent: "listen", when: "event.intensity < 0.3", score: 3 },
        ],
        checks: [{ id: "honesty", when: "event.type == 'care'", expr: '"1d20+0"', dc: 10 }],
        router: {
          triggers: {},
          budget: {
            syncCallsPerTurn: 2,
            s2PerTurn: 2,
            s2Ratio: 0.5,
            s2ReservedForAnchors: 0,
            maxOutputTokens: { s1: 400, s2: 800 },
          },
        },
        render: { retryOnMismatch: 0, recentTurns: 8 },
        cues: { types: { emotion: { args: { mood: { type: "string" } } } } },
        choices: { enabled: false, count: 3, filter: "true" },
        memory: {
          write: { episodic: true, minIntensity: 0.1, maxChars: 200 },
          forgetting: { enabled: false, tau: 30, threshold: 0.2 },
          distortion: { enabled: false, p: 0, maxImportance: 1, kinds: [] },
          propagation: { enabled: false, onTick: "day", distortionPerHop: 1 },
        },
        reflection: { enabled: false, accept: "true" },
        scene: {
          turnTaking: "addressed",
          autonomous: { maxExchangesPerPlayerTurn: 0, when: "true" },
        },
        fields: { grants: [{ holder: "true", source: "true", maxLevel: "L4" }], caps: {} },
        safety: { enabled: false, response: "in_character", log: false },
        timeline: { allowRewind: true, carry: [] },
        visibility: { rules: [] },
      },
    },
  ],
};

export async function seedE2eAuthored(storage: StoragePort): Promise<void> {
  await storage.writeAtomic(
    "animae.yaml",
    `seed: 42
preset: e2e
policies: []
`,
  );
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
  gold: 5
`,
  );
  await storage.writeAtomic(
    "world/locations/tavern.yaml",
    `id: tavern
name: Tavern
summary: A cozy tavern.
tags: []
connects: []
vars: {}
`,
  );
  await storage.writeAtomic("characters/player/card.md", card("player", "Player"));
  await storage.writeAtomic("characters/npc1/card.md", card("npc1", "Aria"));
  await storage.writeAtomic("characters/npc2/card.md", card("npc2", "Ben"));
  await storage.writeAtomic(
    "characters/npc1/relations.yaml",
    `- to: player
  kind: friend
  tracks:
    affinity: 55
  share: "false"
`,
  );
  await storage.writeAtomic(
    "world/fields/salience.yaml",
    `id: salience
holder:
  kind: character
  ref: npc1
source: author
level: L1
priority: 0
stacking: add
scope:
  when: "true"
effects:
  track_offset:
    affinity: 2
`,
  );
}
