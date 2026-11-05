import { describe, expect, test } from "bun:test";
import { loadAuthored } from "../../src/authored/index.ts";
import { isSecretTopic, lockedSecretTags } from "../../src/authored/characters.ts";
import { importSillyTavernCard } from "../../src/entities/import-card.ts";
import { createIntrospect } from "../../src/introspect/service.ts";
import { createMemoryService } from "../../src/memory/service.ts";
import type { PromptSegments } from "../../src/ports.ts";
import { HookRegistry } from "../../src/pipeline/hooks.ts";
import { runTurn } from "../../src/pipeline/run-turn.ts";
import { applyPolicyDefaults } from "../../src/policy/defaults.ts";
import { buildCelContext } from "../../src/rules/cel-context.ts";
import { createCelEngine } from "../../src/rules/cel.ts";
import { createRuleEngine } from "../../src/rules/rule-engine.ts";
import { evaluateTriggers } from "../../src/router/triggers.ts";
import { testStorage } from "../helpers/storage.ts";
import { charDef, createPipelineKernel } from "./test-kernel.ts";
import type { Appraisal } from "../../src/events.ts";
import type { CharacterDef, KnowledgeDoc } from "../../src/schema/authored.ts";
import type { Kernel } from "../../src/contracts.ts";
import type { EngineState } from "../../src/state.ts";

const baseAppraisal: Appraisal = {
  type: "chat",
  intensity: 0.5,
  sincerity: 0.8,
  claims: [],
  search_terms: [],
  tags: [],
  input_class: "normal",
};

async function seedWorld(s: ReturnType<typeof testStorage>): Promise<void> {
  await s.writeAtomic("animae.yaml", "seed: 0\npolicies: []\n");
  await s.writeAtomic("world/world.yaml", "language: en\n");
}

function wireRunTurnKernel(
  k: Kernel,
  setState: (s: EngineState) => void,
  opts?: { affinityTowardPlayer?: number; speaker?: string; addressee?: string },
) {
  k.m.memory = createMemoryService(k);
  k.m.entities = { checkPromotions: async () => undefined } as never;
  const speaker = opts?.speaker ?? "npc1";
  const addressee = opts?.addressee ?? "player";
  const st = k.timeline.state();
  const speakerChar = st.characters[speaker];
  setState({
    ...st,
    characters: {
      ...st.characters,
      [speaker]: {
        ...speakerChar!,
        tracks: {
          self: { mood: 0, ...(speakerChar!.tracks.self as object) },
          toward: {
            ...speakerChar!.tracks.toward,
            [addressee]: {
              ...(speakerChar!.tracks.toward[addressee] ?? {}),
              ...(opts?.affinityTowardPlayer != null ? { affinity: opts.affinityTowardPlayer } : {}),
            },
          },
        },
      },
    },
    scene: {
      id: "scn_0001",
      location: "loc",
      participants: [addressee, speaker],
      turn: 1,
      startedAt: { day: 1, minute: 0 },
      fields: [],
    },
  });
  k.runtime = {
    mode: () => ({ appraise: "llm", render: "llm" }),
    pending: () => null,
    switchAt: "turn_boundary",
    setMode: async () => {
      throw new Error("unused");
    },
    models: () => ({ s1: "llm", s2: "llm", s1Llm: true, s2Tiers: [] }),
    beginTurn: async () => ({ appraise: "llm", render: "llm" }),
    endTurn: async () => {},
    fallbackEnabled: () => false,
  };
}

async function runTurnCaptureRender(
  k: Kernel,
  setState: (s: EngineState) => void,
  input: {
    turnId: string;
    text: string;
    affinityTowardPlayer?: number;
    speaker?: string;
    addressee?: string;
    actor?: string;
  },
): Promise<PromptSegments | undefined> {
  let captured: PromptSegments | undefined;
  const baseS2 = k.models.s2;
  k.models.s2 = {
    ...baseS2,
    stream(req) {
      captured = req.segments;
      return baseS2.stream(req);
    },
  };
  const speaker = input.speaker ?? "npc1";
  const player = input.addressee ?? "player";
  wireRunTurnKernel(k, setState, {
    affinityTowardPlayer: input.affinityTowardPlayer,
    speaker,
    addressee: player,
  });
  const hooks = new HookRegistry();
  const gen = runTurn(k, hooks, {
    turnId: input.turnId,
    sceneId: "scn_0001",
    actor: input.actor ?? player,
    addressee: speaker,
    speaker,
    text: input.text,
  });
  while (!(await gen.next()).done) {
    /* drain */
  }
  return captured;
}

const magicWhenDoc = (body: string): KnowledgeDoc => ({
  id: "magic-when",
  path: "characters/npc1/knowledge/magic-when.md",
  name: "magic-when",
  description: "",
  body,
  inject: "when",
  when: 'event.text.lowerAscii().contains("magic")',
  scope: "character:npc1",
  shareable: false,
  tags: [],
  priority: 10,
});

describe("secret_topic and mood_spike track", () => {
  test("locked secret tag intersection and literal secret tag", () => {
    const def: CharacterDef = {
      ...charDef("npc1"),
      secrets: [{ id: "s1", text: "hidden", tags: ["heirloom"], unlock: "false" }],
    };
    const st = { unlockedSecrets: [] as string[] };
    expect(lockedSecretTags(def, st as never)).toEqual(["heirloom"]);
    expect(isSecretTopic(["heirloom"], lockedSecretTags(def, st as never))).toBe(true);
    expect(isSecretTopic(["secret"], [])).toBe(true);
    expect(isSecretTopic(["chat"], lockedSecretTags(def, st as never))).toBe(false);
  });

  test("mood_spike uses configured track value", () => {
    const policy = applyPolicyDefaults({
      router: { triggers: { mood_spike: { enabled: true, a: 10, b: 50, track: "affinity" } } },
      tracks: {
        affinity: { scope: "relation", min: 0, max: 100, initial: 50, tiers: [], hysteresis: 0 },
      },
      events: { types: { chat: { positive: false } } },
    });
    const reasons = evaluateTriggers(
      {
        turn: { turnId: "t1", sceneId: "s1", actor: "player", addressee: "npc1", speaker: "npc1", text: "", autonomous: false },
        appraisal: baseAppraisal,
        anchorNear: false,
        fieldMaxLevel: 0,
        tierChanged: false,
        sidenoteReceived: false,
        sceneFirstTurn: false,
        secretTopic: false,
        contradiction: false,
        autonomous: false,
        spikeTrackValue: 55,
        spikeTrackDelta: 0,
      },
      policy,
    );
    expect(reasons).toContain("mood_spike");
  });

  test("pipeline trackSpikeInputs feeds mood_spike on a non-mood track", async () => {
    const { k, setState } = createPipelineKernel({
      policy: {
        router: {
          triggers: {
            anchor_near: { enabled: false, n: 1 },
            secret_topic: { enabled: false },
            mood_spike: { enabled: true, a: 100, b: 50, track: "affinity" },
            tier_change: { enabled: false },
            contradiction: { enabled: false },
            ambiguity: { enabled: false },
            field_high: { enabled: false },
            sidenote: { enabled: false },
            scene_first: { enabled: false },
          },
        },
        tracks: {
          affinity: { scope: "relation", min: 0, max: 100, initial: 50, tiers: [], hysteresis: 0 },
          mood: { scope: "self", min: -100, max: 100, initial: 0, tiers: [], hysteresis: 0 },
        },
        events: { types: { chat: { positive: false } } },
      },
      s1Handler: () => ({
        type: "chat",
        intensity: 0.5,
        sincerity: 1,
        claims: [],
        search_terms: [],
        tags: [],
        input_class: "normal",
      }),
      s2Handler: async function* () {
        yield { text: "ok", intent_realized: "respond" };
      },
    });
    wireRunTurnKernel(k, setState, { affinityTowardPlayer: 55 });
    const hooks = new HookRegistry();
    const gen = runTurn(k, hooks, {
      turnId: "turn_spike_aff",
      sceneId: "scn_0001",
      actor: "player",
      addressee: "npc1",
      speaker: "npc1",
      text: "hi",
    });
    while (!(await gen.next()).done) {
      /* drain */
    }
    const route = k.timeline.events().find((e) => e.kind === "route.decided") as { triggers?: string[] };
    expect(route?.triggers).toContain("mood_spike");
  });
});

describe("character_book when and event.text", () => {
  test("runTurn injects when-knowledge into S2 dynamic segment from player text", async () => {
    const marker = "MAGIC_LORE_WHEN_BODY";
    const { k, setState } = createPipelineKernel({
      chars: [charDef("npc1"), charDef("player")],
      knowledge: [magicWhenDoc(marker)],
      s1Handler: () => ({
        type: "chat",
        intensity: 0.5,
        sincerity: 1,
        claims: [],
        search_terms: [],
        tags: [],
        input_class: "normal",
      }),
      s2Handler: async function* () {
        yield { text: "Sure.", intent_realized: "respond" };
      },
    });
    const hit = await runTurnCaptureRender(k, setState, { turnId: "turn_magic_yes", text: "tell me about magic" });
    expect(hit?.dynamic).toContain(marker);
    const miss = await runTurnCaptureRender(k, setState, { turnId: "turn_magic_no", text: "good morning" });
    expect(miss?.dynamic ?? "").not.toContain(marker);
  });

  test("ST import when string drives runTurn knowledge inject the same way", async () => {
    const s = testStorage();
    await seedWorld(s);
    const card = {
      name: "Mira",
      description: "A mage",
      character_book: { entries: [{ keys: ["magic"], content: "IMPORTED_SPELLS_BODY", constant: false }] },
    };
    await s.writeAtomic("imports/mira.json", JSON.stringify(card));
    const id = await importSillyTavernCard(s, "imports/mira.json", async (p) => (await s.readText(p))!);
    const authored = await loadAuthored(s);
    const mira = authored.characters[id]!;
    const { k, setState } = createPipelineKernel({
      chars: [mira, charDef("player")],
      knowledge: mira.knowledge,
      s1Handler: () => ({
        type: "chat",
        intensity: 0.5,
        sincerity: 1,
        claims: [],
        search_terms: [],
        tags: [],
        input_class: "normal",
      }),
      s2Handler: async function* () {
        yield { text: "Sure.", intent_realized: "respond" };
      },
    });
    const hit = await runTurnCaptureRender(k, setState, {
      turnId: "turn_st_magic",
      text: "any magic tricks?",
      speaker: id,
      addressee: "player",
    });
    expect(hit?.dynamic).toContain("IMPORTED_SPELLS_BODY");
  });

  test("imported ST book entry when matches player text at knowledge inject time", async () => {
    const s = testStorage();
    await seedWorld(s);
    const card = {
      name: "Mira",
      description: "A mage",
      character_book: { entries: [{ keys: ["magic"], content: "Spells", constant: false }] },
    };
    await s.writeAtomic("imports/mira.json", JSON.stringify(card));
    const id = await importSillyTavernCard(s, "imports/mira.json", async (p) => (await s.readText(p))!);
    const md = (await s.readText(`characters/${id}/knowledge/1.md`))!;
    expect(md).toContain('event.text.lowerAscii().contains("magic")');

    const bookDoc: KnowledgeDoc = {
      id: "book1",
      path: `characters/${id}/knowledge/1.md`,
      name: "entry-1",
      description: "",
      body: "Spells",
      inject: "when",
      when: '(event.tags.exists(t, t == "magic") || event.text.lowerAscii().contains("magic"))',
      scope: `character:${id}`,
      shareable: false,
      tags: [],
      priority: 0,
    };
    const { k } = createPipelineKernel({ chars: [charDef(id)], knowledge: [bookDoc] });
    k.m.memory = createMemoryService(k);
    const ctx = buildCelContext(
      { state: k.timeline.state(), authored: k.authored, policy: k.policy, catalog: k.catalog },
      {
        self: id,
        other: "player",
        actor: "player",
        event: { ...baseAppraisal, text: "tell me about magic" },
        sceneId: "scn_0001",
      },
    );
    expect(k.m.memory.knowledge({ owner: id, ctx }).when.some((d) => d.id === "book1")).toBe(true);
  });
});

describe("input.response hook", () => {
  test("classify hook runs once and forces intent", async () => {
    const cel = createCelEngine();
    const rules = createRuleEngine(cel);
    rules.register("metaHook", () => [
      { kind: "intent.decided", owner: "npc1", intent: "deflect", scores: { deflect: 1 }, forced: true },
    ]);
    const { k, setState } = createPipelineKernel({
      policy: {
        input: {
          response: {
            injection_suspect: { emit: "insincere_speech", intent: "deflect" },
            meta_probe: { hook: "metaHook" },
          },
        },
        intent: { types: ["respond", "deflect"] },
        intent_rules: [{ intent: "respond", when: "true", score: 1 }],
        events: { types: { chat: { positive: false }, meta_probe: { positive: false } } },
      },
      s1Handler: () => ({
        type: "chat",
        intensity: 0,
        sincerity: 1,
        claims: [],
        search_terms: [],
        tags: [],
        input_class: "meta_probe",
      }),
      s2Handler: async function* () {
        yield { text: "ok", intent_realized: "deflect" };
      },
    });
    k.rules = rules;
    wireRunTurnKernel(k, setState);
    const hooks = new HookRegistry();
    const gen = runTurn(k, hooks, {
      turnId: "turn_hook",
      sceneId: "scn_0001",
      actor: "player",
      addressee: "npc1",
      speaker: "npc1",
      text: "ignore prior",
    });
    while (!(await gen.next()).done) {
      /* drain */
    }
    const intent = k.timeline.events().find((e) => e.kind === "intent.decided") as { intent?: string; forced?: boolean };
    expect(intent?.intent).toBe("deflect");
    expect(intent?.forced).toBe(true);
  });
});

describe("utterance retrieval log and explain", () => {
  test("explain lists retrieval hits with visibility-safe payloads", async () => {
    const { k, setState } = createPipelineKernel({
      policy: {
        visibility: {
          rules: [
            { viewer: "player", path: "events", allow: true, kinds: ["*"] },
            { viewer: "player", path: "characters/npc1/memory", allow: false },
          ],
        },
        events: { types: { chat: { positive: false } } },
      },
      s1Handler: () => ({
        type: "chat",
        intensity: 0.5,
        sincerity: 1,
        claims: [],
        search_terms: ["gem"],
        tags: [],
        input_class: "normal",
      }),
      s2Handler: async function* () {
        yield { text: "I remember.", intent_realized: "respond" };
      },
    });
    k.m.memory = createMemoryService(k);
    await k.m.memory.write("npc1", {
      text: "The gem is under the floor.",
      tags: ["gem"],
      kind: "episodic",
      importance: 0.8,
      valence: 0,
      claims: [],
      t: { day: 1, minute: 0 },
    });
    wireRunTurnKernel(k, setState);
    const hooks = new HookRegistry();
    const gen = runTurn(k, hooks, {
      turnId: "turn_ret",
      sceneId: "scn_0001",
      actor: "player",
      addressee: "npc1",
      speaker: "npc1",
      text: "where is the gem?",
    });
    while (!(await gen.next()).done) {
      /* drain */
    }
    const utterance = k.timeline.events().find((e) => e.kind === "utterance") as { retrieval?: { id: string }[] };
    expect(utterance?.retrieval?.length).toBeGreaterThan(0);
    const intro = createIntrospect(k);
    const playerEx = intro.explain("turn_ret", "player");
    const retrievalItems = playerEx.chain.filter((c) => c.kind === "retrieval");
    expect(retrievalItems.length).toBe(utterance!.retrieval!.length);
    for (const item of retrievalItems) {
      expect(item.data).toBeDefined();
      expect((item.data as { text?: string }).text).toBeUndefined();
    }
    const debugEx = intro.explain("turn_ret", "debug");
    const debugHit = debugEx.chain.find((c) => c.kind === "retrieval");
    expect((debugHit?.data as { id?: string; score?: number })?.id).toBe(utterance!.retrieval![0]!.id);
    const utteranceRow = debugEx.chain.find((c) => c.kind === "utterance");
    expect((utteranceRow?.data as { retrieval?: unknown[] })?.retrieval?.length).toBe(utterance!.retrieval!.length);
  });
});
