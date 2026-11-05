import { describe, expect, test } from "bun:test";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { reduce } from "../../src/timeline/reducer.ts";
import { initialState } from "../../src/timeline/initial-state.ts";
import { minimalAuthored, minimalPolicy } from "../timeline/fixture.ts";
import { FsStorage } from "../../src/store/fs.ts";
import { createScriptedModel } from "../../src/model/scripted.ts";
import { createCelEngine } from "../../src/rules/cel.ts";
import { fulfillEntityGenerateRequest } from "../../src/entities/fulfill-generate.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createEngine } from "../../src/engine/create-engine.ts";
import { seedE2eAuthored } from "../e2e/fixture.ts";
import { playTurn, startScene } from "../helpers/rule-fixture.ts";
import { rulePreset } from "../helpers/rule-fixture.ts";
import type { EngineEvent } from "../../src/types.ts";
import type { EntityGenerate } from "../../src/events.ts";
import { loadAuthored } from "../../src/authored/index.ts";
import { testStorage } from "../helpers/storage.ts";
import { createEntityService } from "../../src/entities/index.ts";
import { noopMutationGate } from "../../src/engine/mutation-gate.ts";
import { createCatalog } from "../../src/authored/index.ts";
import type { Kernel } from "../../src/contracts.ts";
import { PolicySchema, type ResolvedPolicy } from "../../src/schema/policy.ts";
import type { EngineState } from "../../src/state.ts";

function scriptedS1(name: string) {
  return createScriptedModel("test/s1", (req) => {
    if (req.purpose === "appraise" || req.label === "appraise") {
      return {
        type: "chat",
        intensity: 0.5,
        sincerity: 0.8,
        claims: [],
        search_terms: [],
        tags: [],
        input_class: "normal",
      };
    }
    return { name, summary: "gen", persona: "A generated extra." };
  });
}

async function writeExtraTemplate(root: string): Promise<void> {
  await mkdir(join(root, "templates/character"), { recursive: true });
  await writeFile(
    join(root, "templates/character/extra.yaml"),
    `fields:
  name:
    type: string
  summary:
    type: string
    optional: true
  persona:
    type: string
guidance: test
defaults:
  tags: []
lod: extra
`,
  );
}

function genPreset() {
  return rulePreset({
    rules: {
      thresholds: [
        {
          id: "spawn_extra",
          when: "true",
          repeat: true,
          emit: {
            kind: "entity.generate",
            request: { kind: "character", template: "extra" },
          },
        },
      ],
    },
  });
}

function scriptedS1EntityFails() {
  return createScriptedModel("test/s1-fail-entity", (req) => {
    if (req.purpose === "entity" || req.label === "generate") throw new Error("model down");
    if (req.purpose === "appraise" || req.label === "appraise") {
      return {
        type: "chat",
        intensity: 0.5,
        sincerity: 0.8,
        claims: [],
        search_terms: [],
        tags: [],
        input_class: "normal",
      };
    }
    return { name: "X", summary: "", persona: "p" };
  });
}

function noopS2() {
  return createScriptedModel("test/s2", () => ({ text: "", cues: [], intent_realized: "talk" }));
}

describe("entity.generate request", () => {
  test("reducer leaves state unchanged for entity.generate", () => {
    const authored = minimalAuthored();
    const policy = minimalPolicy();
    let s = initialState(authored, policy);
    s = reduce(
      s,
      {
        id: "evt_0001",
        kind: "entity.generate",
        request: { kind: "character", template: "extra" },
        t: s.time,
        sid: "s",
        source: "test",
        because: [],
      },
      policy,
    );
    expect(s.generated.characters).toEqual({});
    expect(s.characters.npc1!.tracks.self.mood).toBe(40);
  });

  test("live emit fulfills into entity.created with because link", async () => {
    const root = await mkdtemp(join(tmpdir(), "animae-eg-"));
    await seedE2eAuthored(FsStorage(root));
    await writeExtraTemplate(root);
    const engine = await createEngine({
      root,
      ports: { storage: FsStorage(root) },
      presets: [genPreset()],
      models: { s1: scriptedS1("Generated One") },
      modelMode: "record",
    });
    try {
      const sceneId = await startScene(engine);
      await playTurn(engine, sceneId, "hello");
      const events = await engine.timeline.events();
      const req = events.find((e) => e.kind === "entity.generate");
      const created = events.find((e) => e.kind === "entity.created") as
        | EngineEvent<{ entity: { id: string }; because: string[] }>
        | undefined;
      expect(req).toBeDefined();
      expect(created).toBeDefined();
      expect(created!.because).toContain(req!.id);
    } finally {
      await engine.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("generation failure emits warning and keeps surrounding events", async () => {
    const root = await mkdtemp(join(tmpdir(), "animae-eg-fail-"));
    await seedE2eAuthored(FsStorage(root));
    await writeExtraTemplate(root);
    const engine = await createEngine({
      root,
      ports: { storage: FsStorage(root) },
      presets: [genPreset()],
      models: { s1: scriptedS1EntityFails() },
      modelMode: "record",
    });
    try {
      const sceneId = await startScene(engine);
      await playTurn(engine, sceneId, "hello");
      const warn = (await engine.timeline.events()).find(
        (e) => e.kind === "config.warning" && (e as { code?: string }).code === "entity.generate_failed",
      );
      expect(warn).toBeDefined();
      expect((await engine.timeline.events()).some((e) => e.kind === "entity.created")).toBe(false);
      expect((await engine.timeline.events()).some((e) => e.kind === "utterance")).toBe(true);
    } finally {
      await engine.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("replay does not regenerate (single entity.created)", async () => {
    const root = await mkdtemp(join(tmpdir(), "animae-eg-replay-"));
    await seedE2eAuthored(FsStorage(root));
    await writeExtraTemplate(root);
    const storage = FsStorage(root);
    const engine = await createEngine({
      root,
      ports: { storage },
      presets: [genPreset()],
      models: { s1: scriptedS1("Replay Guard") },
      modelMode: "record",
    });
    try {
      const sceneId = await startScene(engine);
      await playTurn(engine, sceneId, "hello");
      expect((await engine.timeline.events()).filter((e) => e.kind === "entity.created").length).toBe(1);
      await engine.close();
      const replayEngine = await createEngine({
        root,
        ports: { storage },
        presets: [genPreset()],
        modelMode: "replay",
      });
      expect((await replayEngine.timeline.events()).filter((e) => e.kind === "entity.created").length).toBe(1);
      await replayEngine.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("invalid payload yields entity.generate_invalid warning", async () => {
    const s = testStorage();
    await s.writeAtomic("animae.yaml", "seed: 0\npolicies: []\n");
    await s.writeAtomic("world/world.yaml", "language: en\n");
    const authored = await loadAuthored(s);
    const warnEvents: { code?: string }[] = [];
    const st: EngineState = {
      time: { day: 1, minute: 0 },
      seq: 1,
      vars: {},
      locations: {},
      items: {},
      characters: {},
      fields: {},
      anchors: {},
      beat: { current: null, entered: [] },
      sidenotes: [],
      exceptions: {},
      schedule: {},
      scene: null,
      sceneCount: 0,
      turnCount: 0,
      counters: {},
      turnAcc: { turn: null, delta: {} },
      windows: {},
      firedThresholds: {},
      grants: [],
      budget: { turns: 0, s2Turns: 0, s2Scene: 0, degraded: [] },
      memoryIndex: {},
      config: { hash: "" },
      generated: { characters: {}, locations: {}, items: {} },
      purged: [],
    };
    const policy = PolicySchema.parse({}) as ResolvedPolicy;
    const catalog = createCatalog(
      () => authored,
      () => st.generated,
    );
    const cel = createCelEngine();
    const k: Kernel = {
      storage: s,
      get authored() {
        return authored;
      },
      get policy() {
        return policy;
      },
      i18n: { locale: "en", promptLocale: "en", outputLocale: "en", contentLocale: "en", fallbackLocale: "en" },
      rules: { cel, register: () => {}, fn: () => undefined, has: () => false, run: () => [] },
      timeline: { branch: () => ({ name: "main" }), state: () => st } as Kernel["timeline"],
      models: { s1: scriptedS1("x"), s2: noopS2() },
      catalog,
      emit: async (drafts) => {
        for (const d of drafts) {
          if ((d as { kind?: string }).kind === "config.warning") warnEvents.push(d as { code?: string });
        }
        return [];
      },
      m: { fields: {} as never, director: { anchorsReferencing: () => [] } as never, world: {} as never, memory: {} as never, introspect: {} as never, router: {} as never, entities: {} as never },
      celContext: () => ({}),
      warn: () => {},
      runExclusive: noopMutationGate().runExclusive,
      acquireExclusive: noopMutationGate().acquireExclusive,
    };
    k.m.entities = createEntityService(k);
    const invalidRequest: EngineEvent<EntityGenerate> = {
      id: "evt_0002",
      kind: "entity.generate",
      request: { kind: "character", template: "" },
      t: st.time,
      sid: "s",
      source: "test",
      because: [],
    };
    await fulfillEntityGenerateRequest(k, invalidRequest);
    expect(warnEvents.some((w) => w.code === "entity.generate_invalid")).toBe(true);
  });
});
