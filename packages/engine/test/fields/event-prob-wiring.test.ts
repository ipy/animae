import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createEngine } from "../../src/engine/create-engine.ts";
import { FsStorage } from "../../src/store/fs.ts";
import { seedE2eAuthored } from "../e2e/fixture.ts";
import { rulePreset } from "../helpers/rule-fixture.ts";
import { playTurn, startScene } from "../helpers/rule-fixture.ts";
import type { RuleFn } from "../../src/contracts.ts";
import { mergeEffectsByLevel } from "../../src/fields/levels.ts";
import { applyPolicyDefaults } from "../../src/policy/defaults.ts";
import { buildPromptSegments } from "../../src/pipeline/prompt.ts";
import type { Kernel } from "../../src/contracts.ts";
function probPreset() {
  return rulePreset({
    rules: {
      custom: [
        {
          id: "ep_adj",
          stage: "adjudicate",
          when: "fields.event_prob.quarrel > 0.1",
          fn: "emit_ep_adj",
        },
        {
          id: "ep_scene_start",
          stage: "scene_start",
          when: "fields.event_prob.quarrel > 0.1",
          fn: "emit_ep_scene_start",
        },
        {
          id: "ep_scene_end",
          stage: "scene_end",
          when: "fields.event_prob.quarrel > 0.1",
          fn: "emit_ep_scene_end",
        },
        {
          id: "ep_daily",
          stage: "daily",
          when: "fields.event_prob.quarrel > 0.1",
          fn: "emit_ep_daily",
        },
      ],
    },
  });
}

function registerMarkers(preset: ReturnType<typeof rulePreset>): ReturnType<typeof rulePreset> {
  const markers: Record<string, RuleFn> = {
    emit_ep_adj: () => [{ kind: "world.var_set", path: "markers.adj", value: 1 }],
    emit_ep_scene_start: () => [{ kind: "world.var_set", path: "markers.scene_start", value: 1 }],
    emit_ep_scene_end: () => [{ kind: "world.var_set", path: "markers.scene_end", value: 1 }],
    emit_ep_daily: () => [{ kind: "world.var_set", path: "markers.daily", value: 1 }],
  };
  return {
    ...preset,
    rules: ({ register }) => {
      preset.rules?.({ register });
      for (const [name, fn] of Object.entries(markers)) register(name, fn);
    },
  };
}

async function writeQuarrelField(root: string): Promise<void> {
  await mkdir(join(root, "world/fields"), { recursive: true });
  await writeFile(
    join(root, "world/fields/quarrel-bias.yaml"),
    `id: quarrel-bias
holder:
  kind: world
source: author
level: L0
priority: 0
stacking: add
scope:
  when: "true"
effects:
  event_prob:
    quarrel: 0.25
`,
  );
}

async function writeExtraTemplate(root: string): Promise<void> {
  await mkdir(join(root, "templates/character"), { recursive: true });
  await writeFile(
    join(root, "templates/character/extra.yaml"),
    `fields:
  name: { type: string }
  persona: { type: string }
guidance: t
defaults: {}
lod: extra
`,
  );
}

async function openEngine(opts: { mode?: "rule" | "llm"; s1?: import("../../src/ports.ts").ModelPort }) {
  const root = await mkdtemp(join(tmpdir(), "animae-epw-"));
  await seedE2eAuthored(FsStorage(root));
  await writeQuarrelField(root);
  await writeExtraTemplate(root);
  const preset = registerMarkers(probPreset());
  const engine = await createEngine({
    root,
    ports: { storage: FsStorage(root) },
    presets: [preset],
    ...(opts.mode === "rule" ? { mode: "rule" } : {}),
    ...(opts.s1 ? { models: { s1: opts.s1 }, modelMode: "record" as const } : {}),
  });
  return { engine, root, preset };
}

describe("fields.event_prob wiring (createEngine)", () => {
  test("adjudicate, scene_start/end, daily, and prompt see active L0 event_prob", async () => {
    const { engine, root } = await openEngine({ mode: "rule" });
    try {
      const sceneId = await startScene(engine);
      expect(await engine.query("debug", "world/vars/markers.scene_start")).toBe(1);

      await playTurn(engine, sceneId, "hello");
      expect(await engine.query("debug", "world/vars/markers.adj")).toBe(1);

      await engine.scene.end(sceneId);
      expect(await engine.query("debug", "world/vars/markers.scene_end")).toBe(1);

      await engine.world.advance("1d");
      expect(await engine.query("debug", "world/vars/markers.daily")).toBe(1);

      expect([...(await engine.timeline.events())].reverse().find((e) => e.kind === "utterance")).toBeDefined();
    } finally {
      await engine.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("prompt field block includes merged L0 event_prob (same merge as render)", () => {
    const merged = mergeEffectsByLevel({
      L0: { event_prob: { quarrel: 0.25 } },
      L1: {},
      L2: {},
      L3: {},
      L4: {},
    });
    expect(merged.event_prob?.quarrel).toBeCloseTo(0.25);
    const k = {
      authored: { world: { language: "en" }, characters: {}, locations: {}, templates: { character: {} } },
      policy: applyPolicyDefaults({
        render: { recentTurns: 8, retryOnMismatch: 0 },
        choices: { enabled: false, count: 0, filter: "true" },
      }),
      timeline: { state: () => ({ time: { day: 1, minute: 480 }, characters: {}, scene: null }), branch: () => ({ name: "main" }) },
      catalog: { character: () => undefined, location: () => undefined, item: () => undefined },
      i18n: { promptLocale: "en", outputLocale: "en", contentLocale: "en" },
      displayText: { resolve: (_l: string, v: unknown) => v },
      models: { s1: { id: "m/s1" }, s2: { id: "m/s2" } },
      celContext: () => ({}),
      m: { memory: { knowledge: () => ({ always: [], when: [], index: [] }) }, director: { beatNote: () => "" } },
    } as unknown as Kernel;
    const segments = buildPromptSegments(k, {
      purpose: "render",
      speaker: "npc1",
      addressee: "player",
      scene: { id: "scn_1", location: "tavern", participants: ["player", "npc1"], turn: 1, firstTurn: true },
      history: [],
      fieldEffects: merged,
      appraisal: { type: "chat", intensity: 0.5, sincerity: 0.8, claims: [], search_terms: [], tags: [], input_class: "normal" },
      intent: { intent: "talk", scores: { talk: 1 }, forced: false },
    });
    expect(`${segments.semiStatic}\n${segments.dynamic}`).toContain("quarrel:0.25");
  });
});
