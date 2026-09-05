import type { Catalog, CelEngine, Director, FieldSystem, Introspect, Kernel, MemoryService, Router, RuleEngine } from "../../src/contracts.ts";
import type { AnchorDef, Authored, CharacterDef, LocationDef, ScheduleItem } from "../../src/schema/authored.ts";
import { applyPolicyDefaults } from "../../src/policy/defaults.ts";
import type { Policy } from "../../src/schema/policy.ts";
import { initialState } from "../../src/timeline/initial-state.ts";
import { reduce } from "../../src/timeline/reducer.ts";
import type { EngineState } from "../../src/state.ts";
import type { ModelPort } from "../../src/ports.ts";
import type { EngineEvent, EventDraft, WorldTime } from "../../src/types.ts";
import { createWorldService } from "../../src/world/service.ts";
import { createDirector } from "../../src/director/director.ts";
import { noopMutationGate } from "../../src/engine/mutation-gate.ts";

export function minimalAuthored(overrides?: {
  schedule?: ScheduleItem[];
  locations?: Record<string, LocationDef>;
  characters?: Record<string, CharacterDef>;
  fields?: Authored["fields"];
  world?: Partial<Authored["world"]>;
  policyLayer?: Policy;
  anchors?: AnchorDef[];
}): { authored: Authored; policy: ReturnType<typeof applyPolicyDefaults> } {
  const policy = applyPolicyDefaults(overrides?.policyLayer ?? {});
  const world = {
    language: "en",
    calendar: {
      units: { minute: 1, hour: 60, day: 1440 },
      sceneMinutes: 30,
      turnMinutes: 1,
      chapters: [
        { id: "ch1", days: [1, 7] as [number, number] },
        { id: "ch2", days: [8, 14] as [number, number] },
      ],
      weekdays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    },
    start: { day: 1, minute: 480 },
    vars: {},
    public_vars: [],
    player: "player",
    factions: {},
    ...overrides?.world,
  };
  const authored: Authored = {
    config: { seed: 0, policies: [] },
    world,
    locations: overrides?.locations ?? {
      tavern: { id: "tavern", name: "Tavern", summary: "", tags: [], connects: [], vars: {} },
    },
    items: {},
    fields: overrides?.fields ?? {},
    anchors: overrides?.anchors ?? [],
    beats: [],
    exceptions: {},
    schedule: overrides?.schedule ?? [],
    decks: [],
    knowledge: [],
    characters: overrides?.characters ?? { npc: minimalCharacter("npc") },
    templates: { character: {}, location: {}, item: {} },
    hash: "test",
    files: {},
  };
  return { authored, policy };
}

export function minimalCharacter(id: string): CharacterDef {
  return {
    id,
    origin: "authored",
    card: {
      identity: { name: id, summary: "", style_examples: [] },
      constraints: { motives: [], bottom_lines: [], taboos: [] },
      tags: [],
      lod: "principal",
    },
    persona: "",
    traits: { event_mult: {} },
    tracks: { self: {}, toward: {}, overrides: {} },
    goals: [],
    secrets: [],
    relations: [],
    knowledge: [],
  };
}

export function fakeCel(): CelEngine {
  return {
    check: () => undefined,
    eval: <T>(expr: string): T => expr as T,
    bool: (expr) => (typeof expr === "boolean" ? expr : expr === "true" || expr === "true"),
    num: (expr) => (typeof expr === "number" ? expr : Number(expr)),
    str: (expr) => String(expr),
  };
}

export function createFakeKernel(opts?: Parameters<typeof minimalAuthored>[0] & {
  rules?: RuleEngine;
  router?: Partial<Router>;
  memory?: Partial<MemoryService>;
  director?: Partial<Director>;
  s1Handler?: (label: string) => unknown;
}) {
  const { authored, policy } = minimalAuthored(opts);
  let state = initialState(authored, policy);
  let seq = 0;
  const events: EngineEvent[] = [];
  const artifactLines: Record<string, unknown[]> = {};

  const ruleFns = new Map<string, import("../../src/contracts.ts").RuleFn>();
  const rules: RuleEngine =
    opts?.rules ??
    ({
      cel: fakeCel(),
      register(name, fn) {
        ruleFns.set(name, fn);
      },
      fn(name) {
        return ruleFns.get(name);
      },
      has(name) {
        return ruleFns.has(name);
      },
      run(name, ctx) {
        const fn = ruleFns.get(name);
        if (!fn) return [];
        return fn({ ...ctx, rng: () => 0.5 });
      },
    } as RuleEngine);

  const catalog: Catalog = {
    character: (id) => authored.characters[id],
    characters: () => Object.values(authored.characters),
    location: (id) => authored.locations[id],
    locations: () => Object.values(authored.locations),
    item: () => undefined,
    template: () => undefined,
    knowledge: () => [],
  };

  const models = {
    s1: {
      id: "scripted/s1",
      object: async (req: { label: string }) => {
        if (opts?.s1Handler) return opts.s1Handler(req.label);
        return { text: "A faint scent lingers." };
      },
      stream: async function* () {},
      usage: () => ({ inputTokens: 0, outputTokens: 0 }),
    } as ModelPort,
    s2: {
      id: "scripted/s2",
      object: async () => ({}),
      stream: async function* () {},
      usage: () => ({ inputTokens: 0, outputTokens: 0 }),
    } as ModelPort,
  };

  const router: Router = {
    decide: () => ({ decision: { tier: "s1", reasons: [], degraded: [] }, events: [] }),
    allow: (job) => {
      if (opts?.router?.allow) return opts.router.allow(job);
      return { ok: true, events: [] };
    },
    ...opts?.router,
  };

  const memory = {
    write: async (owner, e) => ({
      id: e.id ?? "mem_1",
      t: e.t,
      kind: e.kind,
      text: e.text,
      tags: e.tags,
      claims: e.claims,
      importance: e.importance,
      valence: e.valence,
      branch: "main",
    }),
    list: async () => [],
    retrieve: async () => [],
    knowledge: () => ({ always: [], when: [], index: [] }),
    readDoc: () => undefined,
    distort: async (h) => h,
    propagateTick: async () => [],
    reflect: async () => [],
    summaryFor: async () => "",
    ...opts?.memory,
  } as MemoryService;

  const director = {
    tick: async () => ({ granted: [], events: [], nearestAnchorScenes: Infinity, anchorNear: false }),
    sidenote: async () => {},
    sidenotesFor: () => [],
    afterRender: async () => {},
    invokeException: async () => ({ eventId: "evt_x", kind: "exception.used", detail: {} }),
    bypassArmed: () => false,
    anchorsReferencing: () => [],
    ...opts?.director,
  } as Director;

  const introspect: Introspect = {
    query: () => undefined,
    grant: async () => {},
    explain: () => ({ turnId: "turn_0", viewer: "player", chain: [] }),
    registerViewer: () => {},
    expireGrants: async () => [],
    canRead: () => true,
  };

  const fields: FieldSystem = {
    resolve: () => ({
      effects: { L0: {}, L1: {}, L2: {}, L3: {}, L4: {} },
      applied: [],
      maxLevel: 0,
      events: [],
    }),
    grant: async () => ({ eventId: "evt_f", kind: "field.granted", detail: {} }),
    revoke: async () => {},
    declare: () => {},
    onTurnEnd: async () => [],
    onSceneEnd: async () => [],
    ledger: () => [],
  };

  const timeline = {
    sessionId: "sid_test",
    state: () => state,
    now: () => state.time,
    append: async (drafts: EventDraft[]) => {
      const out: EngineEvent[] = [];
      for (const d of drafts) {
        seq += 1;
        const ev = {
          id: `evt_${String(seq).padStart(4, "0")}`,
          sid: "sid_test",
          source: d.source ?? "test",
          because: d.because ?? [],
          t: d.t ?? { ...state.time },
          ...d,
        } as EngineEvent;
        events.push(ev);
        state = reduce(state, ev, policy);
        out.push(ev);
      }
      return out;
    },
    rng: () => ({ next: () => 0.5, int: (a: number) => a, pick: <T>(xs: T[]) => xs[0]! }),
    events: () => events,
    artifacts: {
      readJsonl: async (path: string) => artifactLines[path] ?? [],
      appendJsonl: async (path: string, obj: unknown) => {
        artifactLines[path] = artifactLines[path] ?? [];
        artifactLines[path]!.push(obj);
      },
      readText: async () => undefined,
      writeText: async () => {},
      list: async () => Object.keys(artifactLines),
    },
  };

  const gate = noopMutationGate();
  const k: Kernel = {
    storage: {} as Kernel["storage"],
    authored,
    policy,
    rules,
    timeline: timeline as unknown as Kernel["timeline"],
    models,
    catalog,
    celContext: () => ({}),
    warn: () => {},
    emit: (drafts, ctx) => timeline.append(drafts.map((d) => ({ ...d, source: d.source ?? ctx?.source ?? "world" }))),
    runExclusive: gate.runExclusive,
    acquireExclusive: gate.acquireExclusive,
    m: {} as Kernel["m"],
  };

  const world = createWorldService(k);
  k.m = { fields, director, world, memory, introspect, router, entities: {} as Kernel["m"]["entities"] };
  if (opts?.director) {
    k.m.director = { ...director, ...opts.director };
  } else if (authored.anchors.length > 0) {
    k.m.director = createDirector(k);
  }

  return { k, world, state: () => state, events: () => events, artifacts: artifactLines, reloadState: (s: EngineState) => { state = s; } };
}
