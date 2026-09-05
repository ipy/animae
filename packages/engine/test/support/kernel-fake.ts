import { applyPolicyDefaults } from "../../src/policy/defaults.ts";
import { createCelEngine } from "../../src/rules/cel.ts";
import type { Authored, CharacterDef, KnowledgeDoc } from "../../src/schema/authored.ts";
import type { ResolvedPolicy } from "../../src/schema/policy.ts";
import type { CelEngine, Kernel, RuleEngine, TimelineStore } from "../../src/contracts.ts";
import type { CelContext } from "../../src/types.ts";
import type { EngineState } from "../../src/state.ts";
import type { EngineEvent, EventDraft, WorldTime } from "../../src/types.ts";
import { initialState } from "../../src/timeline/initial-state.ts";
import { createArtifactStore } from "../../src/timeline/artifacts.ts";
import { createRng } from "../../src/timeline/rng.ts";
import { MemoryStorage } from "../../src/store/memory.ts";
import { formatEventId } from "../../src/timeline/ids.ts";
import { reduce } from "../../src/timeline/reducer.ts";
import { noopMutationGate } from "../../src/engine/mutation-gate.ts";

export function createTestCel(): CelEngine {
  return createCelEngine();
}

function minimalAuthored(chars: CharacterDef[], knowledge: KnowledgeDoc[] = []): Authored {
  return {
    hash: "test",
    config: { seed: 1, policies: [] },
    world: {
      title: "t",
      language: "en",
      calendar: { units: { minute: 1, hour: 60, day: 1440 }, sceneMinutes: 30, turnMinutes: 1, chapters: [] },
      start: { day: 1, minute: 0 },
      vars: { secret: 1, public: 2 },
      public_vars: ["public"],
      player: "player",
      start_location: "loc",
      factions: {},
    },
    locations: { loc: { id: "loc", name: "Loc", summary: "", tags: [], connects: [], vars: {} } },
    items: {},
    characters: Object.fromEntries(chars.map((c) => [c.id, c])),
    fields: {},
    files: {},
    anchors: [],
    schedule: [],
    knowledge,
    beats: [],
    templates: { character: {}, location: {}, item: {} },
    exceptions: {},
  };
}

export function charDef(id: string, lod: "extra" | "supporting" | "principal" = "principal"): CharacterDef {
  return {
    id,
    origin: "authored",
    card: {
      identity: { name: id, summary: "", style_examples: [] },
      constraints: { motives: [], bottom_lines: [{ id: "bl1", text: "no harm", tags: ["violence"], hardness: "hard" }], taboos: ["crime"] },
      tags: [],
      lod,
    },
    persona: "",
    traits: { event_mult: {} },
    tracks: { self: {}, toward: {}, overrides: {} },
    goals: [{ id: "g1", text: "survive", tags: [], priority: 0 }],
    secrets: [],
    relations: [{ to: "player", kind: "ally", share: "true" }],
    knowledge: [],
  };
}

export interface FakeKernelOpts {
  policy?: Partial<import("../../src/schema/policy.ts").Policy>;
  chars?: CharacterDef[];
  knowledge?: KnowledgeDoc[];
  fields?: Kernel["m"]["fields"];
  world?: Partial<Kernel["m"]["world"]>;
  director?: Partial<Kernel["m"]["director"]>;
  embedding?: Kernel["embedding"];
  s2Handler?: (req: { label: string }) => unknown;
}

export function createFakeKernel(opts: FakeKernelOpts = {}): { k: Kernel; emitted: EventDraft[]; setState: (s: EngineState) => void } {
  const storage = MemoryStorage("test");
  const policy: ResolvedPolicy = applyPolicyDefaults({ ...(opts.policy ?? {}) });
  const chars = opts.chars ?? [charDef("npc1"), charDef("player", "supporting")];
  const authored = minimalAuthored(chars, opts.knowledge ?? []);
  let state = initialState(authored, policy);
  const chain = [{ name: "main" }];
  let seq = state.seq;
  const events: EngineEvent[] = [];
  const emitted: EventDraft[] = [];

  const artifacts = createArtifactStore(
    storage,
    () => chain,
    () => seq,
    () => "main",
  );

  const timeline: TimelineStore = {
    sessionId: "sess",
    async open() {},
    async close() {},
    branch: () => ({ name: "main" }),
    chain: () => chain,
    state: () => state,
    now: () => state.time,
    events: () => events,
    eventsByTurn: (turn) => events.filter((e) => e.turn === turn),
    on: () => () => {},
    rng: (key) => createRng(authored.config.seed, "main", key),
    artifacts,
    recordings: { mode: "live", lookup: () => undefined, record: async () => {} },
    append: async (drafts) => {
      const out: EngineEvent[] = [];
      for (const d of drafts) {
        seq += 1;
        const { kind, source, because, ...payload } = d;
        const e = {
          ...payload,
          id: formatEventId(seq),
          kind,
          t: state.time,
          sid: "sess",
          source: source ?? "test",
          because: because ?? [],
        } as EngineEvent;
        events.push(e);
        state = reduce(state, e, policy);
        out.push(e);
      }
      return out;
    },
    save: async () => ({ label: "s", branch: "main", eventId: "evt_0001", createdAt: new Date().toISOString() }),
    saves: async () => [],
    load: async () => {},
    rewind: async () => ({ name: "main" }),
    branches: async () => [{ name: "main" }],
    switch: async () => {},
    diff: async () => ({ state: [], events: { onlyA: [], onlyB: [] } }),
    prune: async () => {},
    purge: async () => {},
    exportBranch: async () => "",
    importFile: async () => ({ name: "main" }),
    readRange: async () => [],
    maybeSnapshot: async () => {},
  };

  const rules: RuleEngine = {
    cel: createCelEngine(),
    register: () => {},
    fn: () => undefined,
    has: () => false,
    run: () => [],
  };

  const gate = noopMutationGate();
  const k: Kernel = {
    storage,
    authored,
    policy,
    rules,
    timeline,
    models: {
      s1: { id: "test/s1", object: async <T>() => ({}) as T, stream: async function* () {}, usage: () => ({ inputTokens: 0, outputTokens: 0 }) },
      s2: {
        id: "test/s2",
        object: async <T>(req: { label: string }) => (opts.s2Handler?.(req) ?? { summaries: ["s1"], goal_changes: [], new_claims: [] }) as T,
        stream: async function* () {},
        usage: () => ({ inputTokens: 0, outputTokens: 0 }),
      },
    },
    embedding: opts.embedding,
    catalog: {
      character: (id) => authored.characters[id],
      characters: () => Object.values(authored.characters),
      location: (id) => authored.locations[id],
      locations: () => Object.values(authored.locations),
      item: () => undefined,
      template: () => undefined,
      knowledge: () => authored.knowledge,
    },
    emit: async (drafts) => {
      emitted.push(...drafts);
      return timeline.append(drafts);
    },
    m: {
      fields: opts.fields ?? ({
        resolve: () => ({ effects: { L0: {}, L1: {}, L2: {}, L3: {}, L4: {} }, applied: [], maxLevel: 0, events: [] }),
        grant: async () => ({ eventId: "evt_0000", kind: "field.granted", detail: {} }),
        revoke: async () => {},
        declare: () => {},
        onTurnEnd: async () => [],
        onSceneEnd: async () => [],
        ledger: () => [],
      } as Kernel["m"]["fields"]),
      director: {
        tick: async () => ({ granted: [], events: [], nearestAnchorScenes: Infinity, anchorNear: false }),
        sidenote: async () => {},
        sidenotesFor: () => [],
        afterRender: async () => {},
        invokeException: async () => ({ eventId: "evt_0000", kind: "x", detail: {} }),
        bypassArmed: () => false,
        anchorsReferencing: () => [],
        ...opts.director,
      } as Kernel["m"]["director"],
      world: {
        now: () => state.time,
        advance: async () => [],
        set: async () => ({ id: "evt_0000", kind: "world.var_set", t: state.time, sid: "s", source: "t", because: [] } as EngineEvent),
        move: async () => ({ id: "evt_0000", kind: "world.moved", t: state.time, sid: "s", source: "t", because: [] } as EngineEvent),
        runSchedule: async () => [],
        catchUp: async () => [],
        interruptLongEvent: async () => [],
        chapter: () => undefined,
        format: (t: WorldTime) => ({ day: t.day, hour: 0, minute: t.minute, hhmm: "00:00" }),
        toMinutes: (t) => t.day * 1440 + t.minute,
        fromMinutes: (m) => ({ day: Math.floor(m / 1440) + 1, minute: m % 1440 }),
        parseDuration: (d) => (typeof d === "number" ? d : 60),
        ...opts.world,
      } as Kernel["m"]["world"],
      memory: null as unknown as Kernel["m"]["memory"],
      introspect: null as unknown as Kernel["m"]["introspect"],
      router: null as unknown as Kernel["m"]["router"],
      entities: null as unknown as Kernel["m"]["entities"],
    },
    celContext: (p) => ({ ...(p.extra ?? {}), self: p.self, other: p.other, actor: p.actor }) as CelContext,
    warn: () => {},
    runExclusive: gate.runExclusive,
    acquireExclusive: gate.acquireExclusive,
  };

  return {
    k,
    emitted,
    setState: (s) => {
      state = s;
    },
  };
}
