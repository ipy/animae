import { expect, test } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ModelPort } from "../../src/ports.ts";
import { fulfillEntityGenerateBatch, fulfillEntityGenerateRequest } from "../../src/entities/fulfill-generate.ts";
import { createEngine } from "../../src/engine/create-engine.ts";
import { FsStorage } from "../../src/store/fs.ts";
import { seedE2eAuthored } from "../e2e/fixture.ts";
import { rulePreset } from "../helpers/rule-fixture.ts";
import { playTurn, startScene } from "../helpers/rule-fixture.ts";
import type { EngineEvent } from "../../src/types.ts";
import { loadAuthored, createCatalog } from "../../src/authored/index.ts";
import { testStorage } from "../helpers/storage.ts";
import { createEntityService } from "../../src/entities/index.ts";
import { buildTestKernel, minimalAuthored } from "../helpers/fake-kernel.ts";
import { PolicySchema, type ResolvedPolicy } from "../../src/schema/policy.ts";
import type { Kernel } from "../../src/contracts.ts";
import type { EngineState } from "../../src/state.ts";
import { noopMutationGate } from "../../src/engine/mutation-gate.ts";

function scriptedS1(): ModelPort {
  return {
    id: "cov/s1",
    async object(req) {
      if (req.purpose === "appraise" || req.label === "appraise") {
        return { type: "chat", intensity: 0.5, sincerity: 0.8, claims: [], search_terms: [], tags: [], input_class: "normal" } as never;
      }
      return { name: "TplNpc", persona: "from template path" } as never;
    },
    async *stream(req) {
      yield { type: "final", value: await this.object(req as never) };
    },
  };
}

async function writeExtra(root: string): Promise<void> {
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

function genPreset() {
  return rulePreset({
    rules: {
      thresholds: [
        {
          id: "spawn_extra",
          when: "true",
          repeat: true,
          emit: { kind: "entity.generate", request: { kind: "character", template: "extra" } },
        },
      ],
    },
  });
}

test("fulfillEntityGenerateRequest template path via createEngine turn", async () => {
  const root = await mkdtemp(join(tmpdir(), "animae-fulfill-tpl-"));
  await seedE2eAuthored(FsStorage(root));
  await writeExtra(root);
  const engine = await createEngine({
    root,
    ports: { storage: FsStorage(root) },
    presets: [genPreset()],
    models: { s1: scriptedS1() },
    modelMode: "record",
  });
  try {
    const sceneId = await startScene(engine);
    await playTurn(engine, sceneId, "go");
    const created = (await engine.timeline.events()).filter((e) => e.kind === "entity.created");
    expect(created.length).toBe(1);
    expect(created[0]!.because?.length).toBe(1);
  } finally {
    await engine.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("fulfillEntityGenerateRequest brief path builds the character from the brief and links it to the request", async () => {
  const root = await mkdtemp(join(tmpdir(), "animae-fulfill-brief-"));
  await seedE2eAuthored(FsStorage(root));
  await writeExtra(root);
  const preset = rulePreset({
    rules: {
      thresholds: [
        {
          id: "spawn_from_brief",
          when: "true",
          repeat: false,
          emit: {
            kind: "entity.generate",
            request: {
              kind: "character",
              template: "extra",
              brief: { kind: "character", archetype: "wandering merchant", tags: ["guest"], avoidNames: [] },
            },
          },
        },
      ],
    },
  });
  const engine = await createEngine({
    root,
    ports: { storage: FsStorage(root) },
    presets: [preset],
    models: { s1: scriptedS1() },
    modelMode: "record",
  });
  try {
    const sceneId = await startScene(engine);
    await playTurn(engine, sceneId, "go");
    const events = await engine.timeline.events();
    const request = events.find((e) => e.kind === "entity.generate");
    const created = events.filter((e) => e.kind === "entity.created") as unknown as EngineEvent<{
      entity: { kind: string; id: string };
      template?: string;
      data: Record<string, unknown>;
    }>[];
    expect(request).toBeDefined();
    expect(created).toHaveLength(1);
    expect(created[0]!.entity.kind).toBe("character");
    expect(created[0]!.template).toBe("extra");
    expect(created[0]!.because).toEqual([request!.id]);
    // The brief went through S1: the proposal's name and persona are on the created entity.
    expect(JSON.stringify(created[0]!.data)).toContain("TplNpc");
    expect(JSON.stringify(created[0]!.data)).toContain("from template path");
    expect(await FsStorage(root).exists(`timelines/main/entities/character/${created[0]!.entity.id}.json`)).toBe(true);
    expect(events.some((e) => e.kind === "config.warning" && String((e as { code?: string }).code).startsWith("entity.generate"))).toBe(false);
  } finally {
    await engine.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("fulfillEntityGenerateBatch processes each persisted generate event", async () => {
  const s = testStorage();
  await s.writeAtomic("animae.yaml", "seed: 0\npolicies: []\n");
  await s.writeAtomic("world/world.yaml", "language: en\n");
  await s.writeAtomic(
    "templates/character/extra.yaml",
    "fields:\n  name:\n    type: string\n  persona:\n    type: string\nguidance: t\ndefaults: {}\nlod: extra\n",
  );
  const authored = await loadAuthored(s);
  let st: EngineState = {
    time: { day: 1, minute: 0 },
    seq: 0,
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
  const catalog = createCatalog(() => authored, () => st.generated);
  const warnings: string[] = [];
  const created: string[] = [];
  const k: Kernel = {
    storage: s,
    get authored() {
      return authored;
    },
    get policy() {
      return policy;
    },
    i18n: { locale: "en", promptLocale: "en", outputLocale: "en", contentLocale: "en", fallbackLocale: "en" },
    rules: { cel: { check: () => undefined, eval: <T>() => false as T, bool: () => false, num: () => 0, str: (x) => String(x) }, register: () => {}, fn: () => undefined, has: () => false, run: () => [] },
    timeline: {
      branch: () => ({ name: "main" }),
      state: () => st,
      rng: () => ({ next: () => 0.1 }),
      append: async (drafts: import("../../src/types.ts").EventDraft[]) =>
        drafts.map((d, i: number) => {
          const ev = { ...d, id: `evt_${i + 1}`, t: st.time, sid: "s", source: "t", because: [] } as EngineEvent;
          if (ev.kind === "entity.created") created.push(ev.id);
          return ev;
        }),
    } as unknown as Kernel["timeline"],
    models: { s1: scriptedS1(), s2: scriptedS1() },
    catalog,
    emit: async (drafts) => {
      for (const d of drafts) {
        if (d.kind === "config.warning") warnings.push((d as { code?: string }).code ?? "");
        if (d.kind === "entity.created") created.push("via-emit");
      }
      st = { ...st, seq: st.seq + drafts.length };
      return drafts.map((d, i) => ({ ...d, id: `evt_e${st.seq - drafts.length + i + 1}`, t: st.time, sid: "s", source: "t", because: [] })) as never;
    },
    m: { fields: {} as never, director: { anchorsReferencing: () => [] } as never, world: {} as never, memory: {} as never, introspect: {} as never, router: {} as never, entities: {} as never },
    celContext: () => ({}),
    warn: () => {},
    runExclusive: noopMutationGate().runExclusive,
    acquireExclusive: noopMutationGate().acquireExclusive,
  };
  k.m.entities = createEntityService(k);
  const persisted = [
    { id: "evt_0001", kind: "entity.generate", request: { kind: "character", template: "extra" }, t: st.time, sid: "s", source: "t", because: [] },
    { id: "evt_0002", kind: "entity.generate", request: { kind: "character", template: "missing" }, t: st.time, sid: "s", source: "t", because: [] },
  ] as EngineEvent[];
  await fulfillEntityGenerateBatch(k, persisted);
  expect(created.length).toBeGreaterThan(0);
  expect(warnings).toContain("NOT_FOUND");
});

test("invalid payload emits entity.generate_invalid warning event", async () => {
  const k = buildTestKernel(minimalAuthored());
  const codes: string[] = [];
  const origEmit = k.emit.bind(k);
  k.emit = async (drafts, ctx) => {
    for (const d of drafts) {
      if (d.kind === "config.warning") codes.push((d as { code?: string }).code ?? "");
    }
    return origEmit(drafts, ctx);
  };
  k.m.entities = createEntityService(k);
  await fulfillEntityGenerateRequest(k, {
    id: "evt_bad",
    kind: "entity.generate",
    t: k.timeline.state().time,
    sid: "s",
    source: "test",
    because: [],
  } as unknown as EngineEvent<import("../../src/events.ts").EntityGenerate>);
  expect(codes).toContain("entity.generate_invalid");
});
