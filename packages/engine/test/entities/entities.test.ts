import { test, expect } from "bun:test";
import { z } from "zod";
import { loadAuthored, createCatalog } from "../../src/authored/index.ts";
import { createEntityService } from "../../src/entities/index.ts";
import { exportAcard, importAcard } from "../../src/entities/acard.ts";
import { buildPngWithCharaChunk, extractSillyTavernJsonFromPng } from "../../src/entities/png-chunks.ts";
import { importSillyTavernCard } from "../../src/entities/import-card.ts";
import { testStorage } from "../helpers/storage.ts";
import type { Kernel } from "../../src/contracts.ts";
import type { ModelPort } from "../../src/ports.ts";
import type { EngineState } from "../../src/state.ts";
import { PolicySchema, type ResolvedPolicy } from "../../src/schema/policy.ts";
import { AnimaeError } from "../../src/types.ts";
import { noopMutationGate } from "../../src/engine/mutation-gate.ts";

function scriptedModel(handler: (schema: z.ZodType<unknown>) => unknown): ModelPort {
  return {
    id: "test/model",
    async object(req) {
      return handler(req.schema) as never;
    },
    async *stream(req) {
      yield { type: "final", value: await this.object(req as never) };
    },
  };
}

async function seedWorld(s: ReturnType<typeof testStorage>): Promise<void> {
  await s.writeAtomic("animae.yaml", "seed: 0\npolicies: []\n");
  await s.writeAtomic("world/world.yaml", "language: fr\n");
  await s.writeAtomic(
    "templates/character/extra.yaml",
    `fields:
  name:
    type: string
  summary:
    type: string
    optional: true
guidance: test
defaults:
  tags: []
lod: extra
promote:
  - to: supporting
    when: "self.interactions > 2"
`,
  );
  await s.writeAtomic(
    "templates/character/supporting.yaml",
    `fields:
  persona:
    type: string
guidance: supporting
defaults: {}
lod: supporting
`,
  );
  await s.writeAtomic(
    "templates/location/place.yaml",
    `fields:
  name:
    type: string
  summary:
    type: string
    optional: true
guidance: loc
defaults: {}
`,
  );
}

function makeKernel(
  s: ReturnType<typeof testStorage>,
  authored: Awaited<ReturnType<typeof loadAuthored>>,
  model: ModelPort,
  state?: Partial<EngineState>,
): Kernel {
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
    ...state,
  };
  const policy = PolicySchema.parse({}) as ResolvedPolicy;
  const emitted: unknown[] = [];
  const catalog = createCatalog(
    () => authored,
    () => st.generated,
  );
  const cel = {
    check: () => undefined as string | undefined,
    eval: <T = unknown>(expr: string): T => {
      if (expr === "true") return true as T;
      if (expr === "false") return false as T;
      if (expr.includes("interactions")) return true as T;
      return false as T;
    },
    bool: (expr: string | boolean, _ctx?: unknown) => (typeof expr === "boolean" ? expr : cel.eval(expr) === true),
    num: (expr: string | number, _ctx?: unknown) => (typeof expr === "number" ? expr : Number(expr)),
    str: (expr: string, _ctx?: unknown) => expr,
  };
  const k: Kernel = {
    storage: s,
    get authored() {
      return authored;
    },
    get policy() {
      return policy;
    },
    i18n: { locale: "en", promptLocale: "fr", outputLocale: "en", contentLocale: "en", fallbackLocale: "en" },
    rules: { cel, register: () => {}, fn: () => undefined, has: () => false, run: () => [] },
    timeline: {
      branch: () => ({ name: "main" }),
      state: () => st,
    } as Kernel["timeline"],
    models: { s1: model, s2: model },
    catalog,
    emit: async (drafts) => {
      emitted.push(...drafts);
      return drafts as never;
    },
    m: {
      fields: {} as never,
      director: { anchorsReferencing: () => [] } as never,
      world: {} as never,
      memory: {} as never,
      introspect: {} as never,
      router: {} as never,
      entities: {} as never,
    },
    celContext: ({ self }) => ({
      self: { id: self, name: self, lod: "extra", tags: [], traits: {}, vars: {}, interactions: 3, location: null },
    }),
    warn: () => {},
    runExclusive: noopMutationGate().runExclusive,
    acquireExclusive: noopMutationGate().acquireExclusive,
  };
  k.m.entities = createEntityService(k);
  return k;
}

test("generate happy path emits entity.created", async () => {
  const s = testStorage();
  await seedWorld(s);
  const authored = await loadAuthored(s);
  const model = scriptedModel(() => ({ name: "New NPC", summary: "A stranger" }));
  const k = makeKernel(s, authored, model);
  const ref = await k.m.entities.generate({ kind: "character", template: "extra" });
  expect(ref).toEqual({ kind: "character", id: "new-npc" });
  const text = await s.readText("timelines/main/entities/character/new-npc.json");
  expect(text).toContain("New NPC");
});

test("generate validation failure from model schema", async () => {
  const s = testStorage();
  await seedWorld(s);
  const authored = await loadAuthored(s);
  const model = scriptedModel(() => ({}));
  const k = makeKernel(s, authored, model);
  await expect(k.m.entities.generate({ kind: "character", template: "extra" })).rejects.toThrow();
});

test("generate duplicate id rejected", async () => {
  const s = testStorage();
  await seedWorld(s);
  const authored = await loadAuthored(s);
  const model = scriptedModel(() => ({ name: "Dup" }));
  const k = makeKernel(s, authored, model, {
    generated: {
      characters: {
        dup: {
          id: "dup",
          origin: "generated",
          card: {
            identity: { name: "Dup", summary: "", style_examples: [] },
            constraints: { motives: [], bottom_lines: [], taboos: [] },
            lod: "extra",
            tags: [],
          },
          persona: "",
          traits: { event_mult: {} },
          tracks: { self: {}, toward: {}, overrides: {} },
          goals: [],
          secrets: [],
          relations: [],
          knowledge: [],
        },
      },
      locations: {},
      items: {},
    },
  });
  await expect(k.m.entities.generate({ kind: "character", template: "extra", hints: { id: "dup" } })).rejects.toMatchObject({
    code: "ENTITY_DUPLICATE",
  });
});

test("import ST JSON card and export acard round trip", async () => {
  const s = testStorage();
  await seedWorld(s);
  const card = {
    name: "Mira",
    description: "A mage",
    personality: "Calm",
    scenario: "Tower",
    first_mes: "Hello",
    mes_example: "<START> Hi",
    character_book: { entries: [{ keys: ["magic"], content: "Spells", constant: false }] },
  };
  await s.writeAtomic("imports/mira.json", JSON.stringify(card));
  const id = await importSillyTavernCard(s, "imports/mira.json", async (p) => (await s.readText(p))!);
  expect(id).toBe("mira");
  const cardMd = await s.readText(`characters/${id}/card.md`);
  expect(cardMd).toContain("Mira");
  expect(cardMd).toContain("A mage");
  const scenario = await s.readText(`characters/${id}/knowledge/scenario.md`);
  expect(scenario).toContain("inject: always");
  const out = await exportAcard(s, id);
  await s.remove(`characters/${id}`, { recursive: true });
  const reId = await importAcard(s, out);
  expect(reId).toBe(id);
});

test("PNG chara chunk extracts v2 json", async () => {
  const payload = Buffer.from(JSON.stringify({ name: "PngHero" })).toString("base64");
  const png = buildPngWithCharaChunk(payload);
  const json = extractSillyTavernJsonFromPng(png);
  expect(JSON.parse(json!).name).toBe("PngHero");
});

test("import card refuses overwrite without suffix", async () => {
  const s = testStorage();
  await seedWorld(s);
  await s.mkdir("characters/hero");
  await s.writeAtomic("characters/hero/card.md", "---\nidentity:\n  name: Hero\ntags: []\n---\n");
  await s.writeAtomic("imports/h.json", JSON.stringify({ name: "Hero" }));
  const id = await importSillyTavernCard(s, "imports/h.json", async (p) => (await s.readText(p))!);
  expect(id).toBe("hero-2");
});

test("promote increases lod", async () => {
  const s = testStorage();
  await seedWorld(s);
  const authored = await loadAuthored(s);
  const model = scriptedModel(() => ({ persona: "Full persona text" }));
  const k = makeKernel(s, authored, model, {
    generated: {
      characters: {
        x: {
          id: "x",
          origin: "generated",
          card: {
            identity: { name: "X", summary: "", style_examples: [] },
            constraints: { motives: [], bottom_lines: [], taboos: [] },
            lod: "extra",
            tags: [],
          },
          persona: "",
          traits: { event_mult: {} },
          tracks: { self: {}, toward: {}, overrides: {} },
          goals: [],
          secrets: [],
          relations: [],
          knowledge: [],
        },
      },
      locations: {},
      items: {},
    },
  });
  await k.m.entities.promote("x", "supporting");
});

test("checkPromotions runs at most one step", async () => {
  const s = testStorage();
  await seedWorld(s);
  const authored = await loadAuthored(s);
  const model = scriptedModel(() => ({ persona: "p" }));
  const k = makeKernel(s, authored, model, {
    generated: {
      characters: {
        y: {
          id: "y",
          origin: "generated",
          card: {
            identity: { name: "Y", summary: "", style_examples: [] },
            constraints: { motives: [], bottom_lines: [], taboos: [] },
            lod: "extra",
            tags: [],
          },
          persona: "",
          traits: { event_mult: {} },
          tracks: { self: {}, toward: {}, overrides: {} },
          goals: [],
          secrets: [],
          relations: [],
          knowledge: [],
        },
      },
      locations: {},
      items: {},
    },
  });
  await k.m.entities.checkPromotions(["y"]);
});
