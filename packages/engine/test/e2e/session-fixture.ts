import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEngine } from "../../src/engine/create-engine.ts";
import type { CreateEngineOptions, Engine } from "../../src/api.ts";
import { createScriptedModel } from "../../src/model/scripted.ts";
import type { PresetBundle } from "../../src/preset.ts";
import { FsStorage } from "../../src/store/fs.ts";
import type { StoragePort } from "../../src/ports.ts";
import type { SceneId, TurnChunk } from "../../src/types.ts";
import { e2ePreset, seedE2eAuthored } from "./fixture.ts";
import { assertLogInvariants, assertSnapshotsMatchReplay } from "./session-invariants.ts";
import { scriptedLlm, type ScriptedLlm, type ScriptedLlmOptions } from "../helpers/llm-scripts.ts";
import { rulePreset, RULE_POLICY_DOC, type RuleEngineHandle, openRuleEngine } from "../helpers/rule-fixture.ts";

export { rulePreset, RULE_POLICY_DOC, scriptedLlm, type ScriptedLlm, type ScriptedLlmOptions };

export const lifecyclePreset = (): PresetBundle => ({
  ...e2ePreset,
  policies: [
    ...e2ePreset.policies,
    {
      name: "session-lifecycle.yaml",
      doc: {
        choices: { enabled: true, count: 2, filter: "true" },
        reflection: { enabled: true, accept: "true" },
        memory: {
          write: { episodic: true, minIntensity: 0.2, maxChars: 400 },
          forgetting: { enabled: false, tau: 30, threshold: 0.2 },
          distortion: { enabled: true, p: 0.35, maxImportance: 1, kinds: ["intensify"] },
          propagation: { enabled: true, onTick: "scene_end", distortionPerHop: 1 },
          weights: { vector: 0 },
        },
        router: {
          triggers: { scene_first: { enabled: true } },
          budget: { syncCallsPerTurn: 4, s2PerTurn: 3, s2Ratio: 1, s2ReservedForAnchors: 0, maxOutputTokens: { s1: 400, s2: 800 } },
          degrade: ["s2_tier_down"],
        },
        scene: {
          turnTaking: "addressed",
          autonomous: { maxExchangesPerPlayerTurn: 1, when: "event.intensity >= 0.6" },
        },
        rules: {
          custom: [{ id: "care_bonus", stage: "adjudicate", when: "event.type == 'care'", fn: "care_bonus" }],
        },
      },
    },
  ],
  rules: ({ register }) => {
    register("care_bonus", () => [{ kind: "track.delta", owner: "npc1", target: "player", track: "mood", delta: 1 }]);
  },
});

export const budgetPreset = (): PresetBundle => ({
  ...e2ePreset,
  policies: [
    ...e2ePreset.policies,
    {
      name: "session-budget.yaml",
      doc: {
        router: {
          triggers: {
            mood_spike: { enabled: true, a: 8, b: 40, track: "mood" },
            secret_topic: { enabled: true },
            scene_first: { enabled: true },
          },
          budget: {
            syncCallsPerTurn: 1,
            s2PerTurn: 1,
            s2Ratio: 1,
            sceneS2Pool: 1,
            s2ReservedForAnchors: 0.5,
            maxOutputTokens: { s1: 400, s2: 800 },
          },
          degrade: ["defer_reflection", "s2_tier_down", "s2_to_rule"],
        },
        reflection: { enabled: true, accept: "true" },
        memory: { propagation: { enabled: false, onTick: "day" } },
      },
    },
  ],
});

export const safetyPreset = (): PresetBundle => ({
  ...e2ePreset,
  policies: [
    ...e2ePreset.policies,
    {
      name: "session-safety.yaml",
      doc: {
        input: {
          response: {
            injection_suspect: { emit: "insincere_speech", intent: "deflect" },
            meta_probe: { hook: "sessionMetaHook" },
          },
        },
        intent: { types: ["talk", "listen", "deflect", "respond"] },
        intent_rules: [
          { intent: "talk", when: "true", score: 1 },
          { intent: "deflect", when: "true", score: 0 },
        ],
        events: {
          types: {
            chat: { positive: true },
            care: { positive: true },
            other: { positive: false },
            insincere_speech: { positive: false },
            meta_probe: { positive: false },
          },
        },
        rules: {
          delta_table: { chat: { affinity: 2 }, insincere_speech: { affinity: 1 } },
        },
        safety: { enabled: true, response: "in_character", log: true },
      },
    },
  ],
  rules: ({ register }) => {
    register("sessionMetaHook", () => [
      { kind: "intent.decided", owner: "npc1", intent: "deflect", scores: { deflect: 1 }, forced: true },
    ]);
  },
});

export async function seedSessionAuthored(storage: StoragePort): Promise<void> {
  await seedE2eAuthored(storage);
  await seedSessionExtras(storage);
  await storage.writeAtomic(
    "characters/npc2/relations.yaml",
    `- to: player
  kind: acquaintance
  tracks:
    affinity: 48
  share: "false"
`,
  );
}

export interface SessionHandle {
  engine: Engine;
  root: string;
  storage: StoragePort;
  reopen(opts?: Partial<CreateEngineOptions>): Promise<Engine>;
  dispose(): Promise<void>;
  audit(opts?: { snapshots?: boolean }): Promise<void>;
}

export async function openSessionEngine(opts: Partial<CreateEngineOptions> & { preset?: PresetBundle; yaml?: string } = {}): Promise<SessionHandle> {
  const root = await mkdtemp(join(tmpdir(), "animae-session-"));
  const storage = FsStorage(root);
  await seedSessionAuthored(storage);
  const { preset = lifecyclePreset(), yaml, ...rest } = opts;
  if (yaml) await storage.writeAtomic("animae.yaml", `seed: 42\npreset: e2e\npolicies: []\n${yaml}\n`);
  const presets = [preset];
  const open = (o: Partial<CreateEngineOptions> = {}) =>
    createEngine({
      root,
      ports: { storage: FsStorage(root) },
      presets,
      seed: 42,
      ...rest,
      ...o,
    });
  const opened: Engine[] = [await open()];
  return {
    engine: opened[0]!,
    root,
    storage,
    reopen: async (o) => {
      const e = await open(o);
      opened.push(e);
      return e;
    },
    dispose: async () => {
      for (const e of opened) await e.close().catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    },
    audit: async (opts?: { snapshots?: boolean }) => {
      const events = await opened[0]!.timeline.events();
      assertLogInvariants(events);
      if (opts?.snapshots !== false) {
        await assertSnapshotsMatchReplay({ storage, branch: "main", presets, events });
      }
    },
  };
}

async function seedSessionExtras(storage: StoragePort): Promise<void> {
  await storage.writeAtomic(
    "characters/npc1/secrets.yaml",
    `- id: heirloom
  text: A hidden ring.
  tags: [heirloom]
  unlock: "false"
`,
  );
  await storage.writeAtomic(
    "characters/npc1/memory/episodic.jsonl",
    `{"id":"mem_seed","kind":"episodic","t":{"day":1,"minute":400},"text":"We met at the tavern last week.","tags":["tavern"],"claims":[],"importance":0.6,"valence":0.2,"shareable":true}
`,
  );
}

export async function openSessionRuleEngine(
  opts: Parameters<typeof openRuleEngine>[0] = {},
): Promise<RuleEngineHandle & { audit: SessionHandle["audit"] }> {
  const h = await openRuleEngine(opts);
  await seedSessionExtras(FsStorage(h.root));
  const preset = opts.preset ?? rulePreset();
  return {
    ...h,
    audit: async (opts?: { snapshots?: boolean }) => {
      const events = await h.engine.timeline.events();
      assertLogInvariants(events);
      if (opts?.snapshots !== false) {
        await assertSnapshotsMatchReplay({
          storage: FsStorage(h.root),
          branch: "main",
          presets: [preset],
          events,
        });
      }
    },
  };
}

export async function collectTurn(iter: AsyncIterable<TurnChunk>): Promise<{ chunks: TurnChunk[]; events: string[] }> {
  const chunks: TurnChunk[] = [];
  const events: string[] = [];
  for await (const c of iter) {
    chunks.push(c);
    if (c.type === "done") events.push(...c.events);
  }
  return { chunks, events };
}

export async function playTurn(engine: Engine, sceneId: SceneId, text: string, extra: { addressee?: string; choiceId?: string; outputLocale?: string } = {}): Promise<TurnChunk[]> {
  return (await collectTurn(engine.scene.turn({ sceneId, actor: "player", text, addressee: "npc1", ...extra }))).chunks;
}

export function forbiddenModels() {
  const calls: string[] = [];
  const handler = (req: { label?: string }) => {
    calls.push(req.label ?? "?");
    throw new Error(`model must not be called: ${req.label}`);
  };
  return {
    calls,
    models: { s1: createScriptedModel("forbidden/s1", handler), s2: createScriptedModel("forbidden/s2", handler) },
  };
}

/** Scripted S2 that streams three partial text chunks before finishing. */
export function streamingLifecycleLlm(turnScripts?: {
  s1?: ScriptedLlmOptions["s1"];
  s2?: ScriptedLlmOptions["s2"];
}): ScriptedLlm {
  let renderN = 0;
  return scriptedLlm({
    ...turnScripts,
    s2: async (req, n) => {
      const custom = await turnScripts?.s2?.(req, n);
      if (custom !== undefined) return custom;
      if (req.label !== "render") return undefined;
      renderN += 1;
      async function* stream() {
        let acc = "";
        acc += `PartA-${renderN} `;
        yield { text: acc };
        acc += "PartB ";
        yield { text: acc };
        acc += "PartC.";
        yield {
          text: acc,
          cues: [{ type: "emotion", args: { mood: "warm" }, at: 0 }],
          intent_realized: "talk",
        };
      }
      return stream();
    },
    s1: (req, n) => {
      const custom = turnScripts?.s1?.(req, n);
      if (custom !== undefined) return custom;
      if (req.label === "appraise") {
        return {
          type: n === 2 ? "care" : "chat",
          intensity: n === 1 ? 0.65 : 0.5,
          sincerity: 0.85,
          claims: n === 3 ? [{ s: "npc1", p: "knows", o: "tavern" }] : [],
          search_terms: n === 4 ? ["tavern", "meeting"] : ["tavern"],
          tags: n === 5 ? ["heirloom"] : ["social"],
          input_class: "normal",
        };
      }
      if (req.label === "reflect") {
        return {
          summaries: ["Scene at the tavern."],
          goal_changes: [
            { action: "add", text: "Stay friendly.", tags: [] },
            { action: "add", text: "Rejected goal.", tags: ["violence"] },
          ],
          new_claims: [],
        };
      }
      return undefined;
    },
  });
}
