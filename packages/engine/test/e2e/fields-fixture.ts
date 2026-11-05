import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEngine } from "../../src/engine/create-engine.ts";
import type { CreateEngineOptions, Engine } from "../../src/api.ts";
import type { PresetBundle } from "../../src/preset.ts";
import { FsStorage } from "../../src/store/fs.ts";
import type { StoragePort } from "../../src/ports.ts";
import type { FieldDef } from "../../src/schema/authored.ts";
import type { ModelRequestBase } from "../../src/ports.ts";
import type { SceneId, TurnChunk } from "../../src/types.ts";
import { artifactPath } from "../../src/timeline/paths.ts";
import { e2ePreset, seedE2eAuthored } from "./fixture.ts";
import { assertLogInvariants, assertSnapshotsMatchReplay } from "./session-invariants.ts";
import { scriptedLlm, type ScriptedLlm, type ScriptedLlmOptions } from "../helpers/llm-scripts.ts";
import { eventsOf } from "../helpers/rule-fixture.ts";

export { scriptedLlm, eventsOf, type ScriptedLlm, type ScriptedLlmOptions };

export function promptBlob(req: ModelRequestBase): string {
  const s = req.segments;
  return [s.static, s.semiStatic, s.dynamic, s.user, ...(s.history ?? []).map((h) => h.content)].join("\n");
}

export function fieldsPreset(extra?: Record<string, unknown>): PresetBundle {
  return {
    ...e2ePreset,
    policies: [
      ...e2ePreset.policies,
      {
        name: "fields-e2e.yaml",
        doc: {
          intent: { types: ["talk", "listen", "respond"] },
          intent_rules: [
            { intent: "talk", when: "true", score: 3 },
            { intent: "listen", when: "true", score: 1 },
          ],
          checks: [{ id: "honesty", when: "event.type == 'care'", expr: '"1d20+0"', dc: 10 }],
          router: {
            triggers: { secret_topic: { enabled: true }, scene_first: { enabled: true } },
            budget: {
              syncCallsPerTurn: 4,
              s2PerTurn: 3,
              s2Ratio: 1,
              s2ReservedForAnchors: 0,
              maxOutputTokens: { s1: 400, s2: 800 },
            },
          },
          rules: {
            custom: [
              {
                id: "prob_flag",
                stage: "adjudicate",
                when: "'care' in fields.event_prob && fields.event_prob.care > 0",
                fn: "prob_flag",
              },
            ],
          },
          memory: {
            write: { episodic: true, minIntensity: 0.1, maxChars: 300 },
            forgetting: { enabled: false, tau: 30, threshold: 0.2 },
            distortion: { enabled: false, p: 0, maxImportance: 1, kinds: [] },
            propagation: { enabled: false, onTick: "day" },
            weights: { vector: 0 },
            k: 6,
          },
          visibility: {
            rules: [
              { viewer: "player", path: "world/vars", allow: true },
              { viewer: "player", path: "world/vars/hidden", allow: false },
              { viewer: "player", path: "characters/npc1", allow: true },
              { viewer: "player", path: "characters/npc1/memory", allow: false },
              { viewer: "player", path: "characters/npc2", allow: true },
              { viewer: "player", path: "events", allow: true, kinds: ["*"] },
              { viewer: "redactor", path: "world/vars", allow: true },
              { viewer: "redactor", path: "characters/npc1", allow: true },
            ],
          },
          ...extra,
        },
      },
    ],
    rules: ({ register }) => {
      register("prob_flag", () => [
        { kind: "track.delta", owner: "npc1", target: "player", track: "mood", delta: 0.01, reason: "event_prob_cel" },
      ]);
      register("l3_mark", () => [
        { kind: "track.delta", owner: "npc1", target: "player", track: "mood", delta: 0.02, reason: "l3_field_rule" },
      ]);
    },
  };
}

export const SECRET_LOW_TEXT = "Low-trust secret prose for render.";
export const SECRET_VAULT_TEXT = "Vault still locked prose.";

/** Trust-track preset for runtime secret unlock (`tracks.trust` toward the actor). */
export function secretTrustPreset(extra?: Record<string, unknown>): PresetBundle {
  return fieldsPreset({
    render: {
      retryOnMismatch: 0,
      recentTurns: 8,
      maxSegmentChars: { static: 12000, semiStatic: 8000, dynamic: 8000 },
    },
    tracks: {
      affinity: { scope: "relation", min: 0, max: 100, initial: 50, tiers: [], hysteresis: 0 },
      mood: { scope: "self", min: 0, max: 100, initial: 50, tiers: [], hysteresis: 0 },
      trust: { scope: "relation", min: 0, max: 100, initial: 40, tiers: [], hysteresis: 0 },
    },
    rules: {
      delta_table: {
        care: { trust: 10, affinity: 3 },
        chat: { trust: 10, affinity: 2 },
        other: { trust: 10, affinity: 1 },
      },
      marginal: { k: 0, halfLifeHours: 24 },
      turn_cap: { affinity: 100, trust: 100 },
      custom: [
        {
          id: "prob_flag",
          stage: "adjudicate",
          when: "'care' in fields.event_prob && fields.event_prob.care > 0",
          fn: "prob_flag",
        },
      ],
    },
    visibility: {
      rules: [
        { viewer: "player", path: "world/vars", allow: true },
        { viewer: "player", path: "world/vars/hidden", allow: false },
        { viewer: "player", path: "characters/npc1", allow: true },
        { viewer: "player", path: "characters/npc1/memory", allow: false },
        { viewer: "player", path: "characters/npc2", allow: true },
        {
          viewer: "player",
          path: "events",
          allow: true,
          kinds: [
            "input.received",
            "appraisal",
            "check.rolled",
            "track.delta",
            "intent.decided",
            "route.decided",
            "utterance",
            "turn.started",
            "turn.ended",
          ],
        },
        { viewer: "redactor", path: "world/vars", allow: true },
        { viewer: "redactor", path: "characters/npc1", allow: true },
      ],
    },
    ...(extra ?? {}),
  });
}

export async function seedSecretTrustAuthored(storage: StoragePort): Promise<void> {
  await seedFieldsAuthored(storage);
  await storage.writeAtomic(
    "characters/npc1/secrets.yaml",
    `- id: trust_low
  text: ${SECRET_LOW_TEXT}
  tags: [heirloom]
  unlock: "tracks.trust >= 50"
- id: trust_high
  text: ${SECRET_VAULT_TEXT}
  tags: [vault]
  unlock: "tracks.trust >= 90"
`,
  );
  await storage.writeAtomic(
    "characters/npc1/relations.yaml",
    `- to: player
  kind: friend
  tracks:
    affinity: 55
    trust: 45
  share: "false"
`,
  );
}

export function trackCapsPreset(): PresetBundle {
  return fieldsPreset({
    rules: {
      delta_table: { care: { affinity: 8, mood: 0 }, chat: { affinity: 8 } },
      marginal: { k: 0, halfLifeHours: 24 },
      turn_cap: { affinity: 100 },
      custom: [],
    },
    events: {
      types: {
        chat: { positive: true },
        care: { positive: true },
        other: { positive: false },
      },
    },
  });
}

export function introspectPreset(): PresetBundle {
  return fieldsPreset({
    offscreen: { fidelity: { default: "rule", locations: { tavern: "rule" }, characters: {} } },
  });
}

export async function seedFieldsAuthored(storage: StoragePort): Promise<void> {
  await seedE2eAuthored(storage);
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
  hidden: 99
public_vars:
  - gold
`,
  );
  await storage.writeAtomic(
    "characters/npc1/secrets.yaml",
    `- id: heirloom
  text: A hidden ring.
  tags: [heirloom]
  unlock: "false"
`,
  );
  await storage.writeAtomic(
    artifactPath("main", "npc1/memory.jsonl"),
    `${JSON.stringify({
      id: "mem_npc1_private",
      t: { day: 1, minute: 400 },
      kind: "episodic",
      text: "Private gem location under the floor.",
      tags: ["gem", "tavern"],
      shareable: false,
      claims: [],
      importance: 0.8,
      valence: 0,
      branch: "main",
    })}
${JSON.stringify({
      id: "mem_npc1_share",
      t: { day: 1, minute: 401 },
      kind: "episodic",
      text: "We chatted at the tavern bar.",
      tags: ["tavern", "social"],
      shareable: true,
      claims: [],
      importance: 0.6,
      valence: 0.2,
      branch: "main",
    })}
`,
  );
  await storage.writeAtomic(
    "characters/npc2/relations.yaml",
    `- to: player
  kind: acquaintance
  tracks:
    affinity: 50
  share: "false"
`,
  );
}


export interface FieldsEngineHandle {
  engine: Engine;
  root: string;
  storage: StoragePort;
  preset: PresetBundle;
  reopen(opts?: Partial<CreateEngineOptions>): Promise<Engine>;
  dispose(): Promise<void>;
  audit(opts?: { snapshots?: boolean }): Promise<void>;
}

export async function openFieldsEngine(
  opts: Partial<CreateEngineOptions> & {
    preset?: PresetBundle;
    /** Extra authored files written after the base fields fixture (distinct from engine `seed` RNG). */
    authoredSeed?: (storage: StoragePort) => Promise<void>;
    onOpen?: (engine: Engine) => void | Promise<void>;
  } = {},
): Promise<FieldsEngineHandle> {
  const root = await mkdtemp(join(tmpdir(), "animae-fields-e2e-"));
  const storage = FsStorage(root);
  await seedFieldsAuthored(storage);
  if (opts.authoredSeed) await opts.authoredSeed(storage);
  const preset = opts.preset ?? fieldsPreset();
  const open = async (o: Partial<CreateEngineOptions> = {}) => {
    const engine = await createEngine({
      root,
      ports: { storage: FsStorage(root) },
      presets: [preset],
      seed: 42,
      ...opts,
      ...o,
    });
    if (opts.onOpen) await opts.onOpen(engine);
    return engine;
  };
  const opened: Engine[] = [await open()];
  return {
    engine: opened[0]!,
    root,
    storage,
    preset,
    reopen: async (o) => {
      const e = await open(o);
      opened.push(e);
      return e;
    },
    dispose: async () => {
      for (const e of opened) await e.close().catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    },
    audit: async (auditOpts?: { snapshots?: boolean }) => {
      const events = await opened[0]!.timeline.events();
      assertLogInvariants(events);
      if (auditOpts?.snapshots !== false) {
        await assertSnapshotsMatchReplay({ storage, branch: "main", presets: [preset], events });
      }
    },
  };
}

export async function playFieldsTurn(
  engine: Engine,
  sceneId: SceneId,
  text: string,
  extra: { addressee?: string } = {},
): Promise<TurnChunk[]> {
  const chunks: TurnChunk[] = [];
  for await (const c of engine.scene.turn({ sceneId, actor: "player", text, addressee: "npc1", ...extra })) {
    chunks.push(c);
  }
  return chunks;
}

export function careScriptedLlm(opts?: {
  tags?: string[];
  captureRender?: (req: ModelRequestBase) => void;
}): ScriptedLlm {
  const tags = opts?.tags ?? [];
  return scriptedLlm({
    s1: (req) =>
      req.label === "appraise"
        ? {
            type: "care",
            intensity: 0.75,
            sincerity: 0.9,
            claims: [],
            search_terms: ["tavern", "gem"],
            tags,
            input_class: "normal",
          }
        : undefined,
    s2: (req) => {
      if (req.label === "render") opts?.captureRender?.(req);
      return undefined;
    },
  });
}

export function fieldDef(partial: Partial<FieldDef> & Pick<FieldDef, "id" | "level" | "effects">): FieldDef {
  return {
    holder: { kind: "character", ref: "npc1" },
    source: "runtime",
    scope: { when: "true" },
    priority: 0,
    stacking: "add",
    ...partial,
  };
}
