import { evaluate, check } from "@marcbachmann/cel-js";
import type { CelEngine, Kernel, RuleEngine, RuleFn, TimelineStore } from "../../src/contracts.ts";
import { reduce } from "../../src/timeline/reducer.ts";
import { initialState } from "../../src/timeline/initial-state.ts";
import { applyPolicyDefaults } from "../../src/policy/defaults.ts";
import type { Authored } from "../../src/schema/authored.ts";
import type { Policy } from "../../src/schema/policy.ts";
import type { EngineEvent, EventDraft, WorldTime } from "../../src/types.ts";
import { formatEventId } from "../../src/timeline/ids.ts";
import { draftToEnvelope } from "../../src/timeline/event-log.ts";
import { createFieldSystem } from "../../src/fields/field-system.ts";
import { createDirector } from "../../src/director/director.ts";
import type { Director, FieldSystem } from "../../src/contracts.ts";
import { noopMutationGate } from "../../src/engine/mutation-gate.ts";

function makeCel(): CelEngine {
  return {
    check(expr: string) {
      try {
        check(expr);
        return undefined;
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
    },
    eval<T>(expr: string, ctx: Record<string, unknown>): T {
      return evaluate(expr, ctx) as T;
    },
    bool(expr: string | boolean, ctx: Record<string, unknown>): boolean {
      if (typeof expr === "boolean") return expr;
      return Boolean(evaluate(expr, ctx));
    },
    num(expr: string | number, ctx: Record<string, unknown>): number {
      if (typeof expr === "number") return expr;
      return Number(evaluate(expr, ctx));
    },
    str(expr: string, ctx: Record<string, unknown>): string {
      return String(evaluate(expr, ctx));
    },
  };
}

export function minimalAuthored(overrides?: Partial<Authored>): Authored {
  return {
    config: { seed: 1, policies: [] },
    world: {
      player: "player",
      start: { day: 1, minute: 480 },
      calendar: { units: { minute: 1, hour: 60, day: 1440 }, sceneMinutes: 30, turnMinutes: 1, chapters: [{ id: "ch1", days: [1, 7] }] },
      vars: {},
      public_vars: [],
      language: "en",
      factions: {},
    },
    locations: { cafe: { id: "cafe", name: "Cafe", summary: "", tags: [], connects: [], vars: {} } },
    items: {},
    fields: {},
    anchors: [],
    beats: [],
    exceptions: {},
    schedule: [],
    decks: [],
    knowledge: [],
    characters: {
      npc: {
        id: "npc",
        origin: "authored",
        card: { identity: { name: "Npc", summary: "", style_examples: [] }, tags: [], lod: "principal", constraints: { motives: [], bottom_lines: [], taboos: [] } },
        persona: "",
        traits: { event_mult: {} },
        goals: [],
        secrets: [],
        relations: [],
        tracks: { self: {}, toward: {}, overrides: {} },
        knowledge: [],
      },
      player: {
        id: "player",
        origin: "authored",
        card: { identity: { name: "Player", summary: "", style_examples: [] }, tags: [], lod: "principal", constraints: { motives: [], bottom_lines: [], taboos: [] } },
        persona: "",
        traits: { event_mult: {} },
        goals: [],
        secrets: [],
        relations: [],
        tracks: { self: {}, toward: {}, overrides: {} },
        knowledge: [],
      },
    },
    templates: { character: {}, location: {}, item: {} },
    hash: "test",
    files: {},
    ...overrides,
  };
}

export function openPolicy(extra?: Partial<Policy>) {
  return applyPolicyDefaults({
    tracks: {},
    fields: {
      grants: [{ holder: "true", source: "true", maxLevel: "L4" }],
      caps: { "salience.boost": 0.4, event_prob: 0.3, track_offset: 20 },
    },
    router: { triggers: { anchor_near: { enabled: true, n: 1 } } },
    ...extra,
  });
}

class FakeTimeline implements TimelineStore {
  private stateInternal;
  private eventsInternal: EngineEvent[] = [];
  private authored: Authored;
  private policy: ReturnType<typeof openPolicy>;
  sessionId = "sess_test";

  constructor(authored: Authored, policy: ReturnType<typeof openPolicy>) {
    this.authored = authored;
    this.policy = policy;
    this.stateInternal = initialState(authored, policy);
  }

  async open(): Promise<void> {}
  async close(): Promise<void> {}
  branch() {
    return { name: "main" };
  }
  chain() {
    return [{ name: "main" }];
  }
  state() {
    return this.stateInternal;
  }
  now(): WorldTime {
    return { ...this.stateInternal.time };
  }
  events(): readonly EngineEvent[] {
    return this.eventsInternal;
  }
  eventsByTurn(): EngineEvent[] {
    return [];
  }
  on(): () => void {
    return () => {};
  }
  rng() {
    return { next: () => 0.5, int: (a: number, b: number) => a, pick: <T>(xs: readonly T[]) => xs[0]! };
  }
  artifacts = {} as TimelineStore["artifacts"];
  recordings = { mode: "live" as const, lookup: () => undefined, record: async () => {} };

  async append(drafts: EventDraft[]): Promise<EngineEvent[]> {
    const out: EngineEvent[] = [];
    for (const d of drafts) {
      let seq = this.stateInternal.seq + 1;
      const env = draftToEnvelope(d, {
        id: formatEventId(seq),
        t: d.t ?? this.now(),
        sid: this.sessionId,
        scene: this.stateInternal.scene?.id,
        turn: undefined,
        source: d.source ?? "test",
        because: d.because ?? [],
      });
      this.stateInternal = reduce(this.stateInternal, env, this.policy);
      this.stateInternal.seq = seq;
      this.eventsInternal.push(env);
      out.push(env);
    }
    return out;
  }

  save = async () => ({ label: "", branch: "main", eventId: "evt_0001", createdAt: "" });
  saves = async () => [];
  load = async () => {};
  rewind = async () => ({ name: "main" });
  branches = async () => [{ name: "main" }];
  switch = async () => {};
  diff = async () => ({ state: [], events: { onlyA: [], onlyB: [] } });
  prune = async () => {};
  purge = async () => {};
  exportBranch = async () => "";
  importFile = async () => ({ name: "main" });
  readRange = async () => [];
  maybeSnapshot = async () => {};
}

export function buildTestKernel(authored: Authored, policy = openPolicy()): Kernel & { fields: FieldSystem; director: Director } {
  const timeline = new FakeTimeline(authored, policy);
  const cel = makeCel();
  const fns = new Map<string, RuleFn>();
  const rules: RuleEngine = {
    cel,
    register(name, fn) {
      fns.set(name, fn);
    },
    fn: (name) => {
      if (fns.has(name)) return fns.get(name);
      if (name === "pick_max") {
        return (ctx) => {
          const vals = (ctx.vars.field_merge_values as number[]) ?? [];
          return [{ kind: "field.resolver", merged: Math.max(...vals) }];
        };
      }
      return undefined;
    },
    has: (name) => fns.has(name) || name === "pick_max",
    run(name, ctx) {
      const fn = rules.fn(name);
      if (!fn) return [];
      return fn({ ...ctx, rng: () => 0.5 });
    },
  };

  const gate = noopMutationGate();
  const k: Partial<Kernel> = {
    storage: {} as Kernel["storage"],
    get authored() {
      return authored;
    },
    get policy() {
      return policy;
    },
    i18n: { locale: "en", promptLocale: "fr", outputLocale: "en", contentLocale: "en", fallbackLocale: "en" },
    rules,
    timeline,
    models: {} as Kernel["models"],
    catalog: {} as Kernel["catalog"],
    celContext(p) {
      const state = timeline.state();
      const time = (p.extra as { time?: WorldTime } | undefined)?.time ?? state.time;
      return {
        world: { vars: state.vars, time, minutes: (time.day - 1) * 1440 + time.minute, location: state.playerLocation },
        time,
        scene: state.scene
          ? { id: state.scene.id, location: state.scene.location, participants: state.scene.participants, turn: state.scene.turn, count: state.sceneCount }
          : null,
        self: p.self ? { id: p.self, name: p.self } : null,
        other: p.other ? { id: p.other, name: p.other } : null,
        ...p.extra,
      };
    },
    warn() {},
    runExclusive: gate.runExclusive,
    acquireExclusive: gate.acquireExclusive,
    emit(drafts, ctx) {
      return timeline.append(
        drafts.map((d) => ({ ...d, source: d.source ?? ctx?.source ?? "test", because: d.because ?? ctx?.because })),
      );
    },
    m: {} as Kernel["m"],
  };

  let director!: Director;
  const kernel = k as Kernel;
  const fields = createFieldSystem(kernel, { bypassArmed: (w) => director?.bypassArmed(w) ?? false });
  kernel.m = {
    fields,
    director: undefined!,
    world: undefined!,
    memory: undefined!,
    introspect: undefined!,
    router: undefined!,
    entities: undefined!,
  };
  director = createDirector(kernel);
  kernel.m.director = director;

  return { ...kernel, fields, director };
}
