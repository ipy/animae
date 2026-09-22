import { z } from "zod";
import { Cel, CelOrBool, CelOrNumber, EventDraftSchema, Id, LevelSchema, LodSchema } from "./common.ts";
import { FieldDescriptorSchema } from "./authored.ts";

/**
 * Policy schema (tracks, checks, rules, retrieval, models). CONTRACT file.
 * A "policy" document is a (partial) policy; the loader deep-merges many documents into one validated `Policy`.
 * Merge conventions (implemented by policy/merge): records merge by key; arrays REPLACE, unless written as
 * `{ $append: [...] }` / `{ $prepend: [...] }` which concatenate to the earlier layer's array.
 */

const Rec = <T extends z.ZodType>(v: T) => z.record(z.string(), v);

export const TierSchema = z.strictObject({ name: z.string(), from: z.number() });

export const TrackDefSchema = z.strictObject({
  /** "relation": value is stored per (owner → target) and the default target is the acting character (usually the player).
   *  "self": one value per character (e.g. mood). */
  scope: z.enum(["self", "relation"]).default("relation"),
  label: z.string().optional(),
  min: z.number(),
  max: z.number(),
  initial: z.number(),
  tiers: z.array(TierSchema).default([]),
  hysteresis: z.number().min(0).default(0),
  /** fraction of the distance to `toward` removed per world hour (0.1 = 10%/h) */
  decay: z.strictObject({ toward: z.number(), ratePerHour: z.number().min(0).max(1) }).optional(),
});
export type TrackDef = z.infer<typeof TrackDefSchema>;

export const EventTypeDefSchema = z.strictObject({
  positive: z.boolean().default(false),
  description: z.string().optional(),
  label: z.string().optional(),
});

const ThresholdSchema = z.strictObject({
  id: Id,
  when: Cel,
  emit: z.union([EventDraftSchema, z.array(EventDraftSchema)]),
  /** fire at most once per (owner,target) pair unless `repeat` is true */
  repeat: z.boolean().default(false),
});

const WindowSchema = z.strictObject({
  id: Id,
  trigger: Cel,
  durationScenes: z.number().int().positive(),
  mult: Rec(z.number()),
  capToLoss: z.boolean().default(false),
});

const CustomRuleSchema = z.strictObject({
  id: Id,
  /** name registered through `engine.rules.register(name, fn)` */
  fn: z.string(),
  when: Cel.optional(),
  stage: z.enum(["adjudicate", "tick", "scene_end", "scene_start", "daily"]).default("adjudicate"),
});

const IntentRuleSchema = z.strictObject({ intent: z.string(), when: Cel, score: CelOrNumber });

const InputResponseSchema = z.union([
  z.strictObject({ emit: z.string().optional(), intent: z.string().optional() }),
  z.strictObject({ hook: z.string() }),
]);

const CheckRuleSchema = z.strictObject({
  id: Id,
  /** CEL; check runs when true */
  when: Cel,
  /** CEL expression producing a dice expression string, e.g. `"1d20+" + string(self.mods.cha)`; or a literal like "1d20" */
  expr: Cel,
  dc: CelOrNumber,
  advantage: CelOrBool.optional(),
  disadvantage: CelOrBool.optional(),
  skill: z.string().optional(),
  /** applied to the appraised event when the check succeeds/fails */
  onSuccess: z.strictObject({ setType: z.string().optional(), addTags: z.array(z.string()).optional(), emit: z.array(EventDraftSchema).optional() }).optional(),
  onFailure: z.strictObject({ setType: z.string().optional(), addTags: z.array(z.string()).optional(), emit: z.array(EventDraftSchema).optional() }).optional(),
});

const FidelitySchema = z.enum(["none", "rule", "narrate", "full"]);

const TriggerBase = { enabled: z.boolean().default(true) };

export const PolicySchema = z.strictObject({
  /** schema extension: validates extra fields in authored files / events */
  schema: z
    .strictObject({
      extend: z
        .strictObject({
          traits: Rec(FieldDescriptorSchema).optional(),
          character: Rec(FieldDescriptorSchema).optional(),
          world: Rec(FieldDescriptorSchema).optional(),
          event: Rec(Rec(FieldDescriptorSchema)).optional(),
        })
        .optional(),
    })
    .optional(),

  events: z.strictObject({ types: Rec(EventTypeDefSchema) }).optional(),
  tracks: Rec(TrackDefSchema).optional(),

  rules: z
    .strictObject({
      delta_table: Rec(Rec(z.number())).optional(),
      marginal: z.strictObject({ k: z.number().min(0), halfLifeHours: z.number().positive() }).optional(),
      turn_cap: Rec(z.number().positive()).optional(),
      windows: z.array(WindowSchema).optional(),
      thresholds: z.array(ThresholdSchema).optional(),
      custom: z.array(CustomRuleSchema).optional(),
    })
    .optional(),

  intent: z.strictObject({ types: z.array(z.string()) }).optional(),
  intent_rules: z.array(IntentRuleSchema).optional(),

  input: z.strictObject({ response: z.record(z.enum(["injection_suspect", "meta_probe"]), InputResponseSchema) }).optional(),
  safety: z
    .strictObject({
      enabled: z.boolean().default(false),
      response: z.string().regex(/^(in_character|out_of_character_notice|block|hook:.+)$/).default("in_character"),
      log: z.boolean().default(false),
    })
    .optional(),

  fields: z
    .strictObject({
      grants: z.array(z.strictObject({ holder: Cel, source: Cel, maxLevel: LevelSchema })).optional(),
      /** keys: "salience.boost", "event_prob", "track_offset", "track_mult" ... values: max absolute magnitude */
      caps: Rec(z.number()).optional(),
    })
    .optional(),

  memory: z
    .strictObject({
      weights: z.strictObject({ term: z.number(), recency: z.number(), importance: z.number(), salience: z.number(), vector: z.number() }).partial().optional(),
      k: z.number().int().positive().optional(),
      recencyHalfLifeDays: z.number().positive().optional(),
      indexMax: z.number().int().positive().optional(),
      write: z.strictObject({ episodic: z.boolean().default(true), minIntensity: z.number().min(0).max(1).default(0.2), maxChars: z.number().int().positive().default(240) }).optional(),
      forgetting: z.strictObject({ enabled: z.boolean().default(false), tau: z.number().positive().default(30), threshold: z.number().min(0).max(1).default(0.2) }).optional(),
      distortion: z
        .strictObject({
          enabled: z.boolean().default(false),
          p: z.number().min(0).max(1).default(0.1),
          maxImportance: z.number().min(0).max(1).default(0.7),
          kinds: z.array(z.enum(["intensify", "swap_subject", "add_motive"])).default(["intensify"]),
        })
        .optional(),
      propagation: z.strictObject({ enabled: z.boolean().default(false), onTick: z.enum(["day"]).default("day"), distortionPerHop: z.number().min(0).default(1) }).optional(),
    })
    .optional(),

  reflection: z.strictObject({ enabled: z.boolean().default(true), accept: Cel.default("!conflict") }).optional(),

  characters: z
    .strictObject({
      lod: z.strictObject({ promote: z.array(z.strictObject({ from: LodSchema, to: LodSchema, when: Cel })).optional() }).optional(),
    })
    .optional(),

  offscreen: z.strictObject({ fidelity: z.strictObject({ default: FidelitySchema.default("rule"), locations: Rec(FidelitySchema).default({}), characters: Rec(FidelitySchema).default({}) }) }).optional(),

  scene: z
    .strictObject({
      turnTaking: z.union([z.enum(["addressed", "round_robin"]), z.strictObject({ priority: Cel })]).optional(),
      autonomous: z.strictObject({ maxExchangesPerPlayerTurn: z.number().int().min(0).default(0), when: Cel.default("true") }).optional(),
    })
    .optional(),

  router: z
    .strictObject({
      triggers: z
        .strictObject({
          anchor_near: z.strictObject({ ...TriggerBase, n: z.number().int().min(0).default(1) }).optional(),
          secret_topic: z.strictObject(TriggerBase).optional(),
          mood_spike: z.strictObject({ ...TriggerBase, a: z.number().default(30), b: z.number().default(80), track: z.string().default("mood") }).optional(),
          tier_change: z.strictObject(TriggerBase).optional(),
          contradiction: z.strictObject(TriggerBase).optional(),
          ambiguity: z.strictObject(TriggerBase).optional(),
          field_high: z.strictObject(TriggerBase).optional(),
          sidenote: z.strictObject(TriggerBase).optional(),
          scene_first: z.strictObject(TriggerBase).optional(),
        })
        .optional(),
      budget: z
        .strictObject({
          syncCallsPerTurn: z.number().int().positive().default(2),
          s2PerTurn: z.number().int().min(0).default(1),
          s2Ratio: z.number().min(0).max(1).default(0.15),
          s2ReservedForAnchors: z.number().min(0).max(1).default(0.03),
          maxOutputTokens: z.strictObject({ s1: z.number().int().positive().default(400), s2: z.number().int().positive().default(800) }).default({ s1: 400, s2: 800 }),
          /** shared S2 pool per scene (calls); default derived from s2Ratio */
          sceneS2Pool: z.number().int().min(0).optional(),
        })
        .optional(),
      degrade: z.array(z.enum(["s2_to_s1", "defer_reflection", "skip_offscreen_narrate", "skip_autonomous"])).optional(),
    })
    .optional(),

  render: z
    .strictObject({
      retryOnMismatch: z.union([z.literal(0), z.literal(1)]).default(0),
      recentTurns: z.number().int().positive().default(12),
      temperature: z.number().optional(),
      /** Optional per-segment character caps (truncate with marker); unlimited when omitted. */
      maxSegmentChars: z
        .strictObject({
          static: z.number().int().positive().optional(),
          semiStatic: z.number().int().positive().optional(),
          dynamic: z.number().int().positive().optional(),
        })
        .optional(),
    })
    .optional(),
  cues: z.strictObject({ types: Rec(z.strictObject({ args: Rec(FieldDescriptorSchema).default({}), description: z.string().optional() })) }).optional(),
  choices: z.strictObject({ enabled: z.boolean().default(false), count: z.number().int().positive().default(3), filter: Cel.default("true") }).optional(),

  timeline: z
    .strictObject({
      allowRewind: z.boolean().default(true),
      carry: z
        .array(
          z.strictObject({
            characters: z.union([z.literal("*"), z.array(z.string())]).default("*"),
            kinds: z.array(z.enum(["memory", "track", "world_var"])),
            tags: z.array(z.string()).default([]),
            when: Cel.default("true"),
          }),
        )
        .optional(),
    })
    .optional(),

  visibility: z
    .strictObject({
      /** evaluated in order, LAST matching rule wins; no match → deny. viewer: exact id or glob ("npc:*", "*"). path: glob over query paths. kinds: for `events` path, restrict by event kind glob list */
      rules: z.array(z.strictObject({ viewer: z.string(), path: z.string(), allow: z.boolean(), kinds: z.array(z.string()).optional() })),
    })
    .optional(),

  checks: z.array(CheckRuleSchema).optional(),

  /** free-form game-specific policy data readable by rule functions as `ctx.policy.x` */
  x: z.record(z.string(), z.unknown()).optional(),
});

export type Policy = z.infer<typeof PolicySchema>;

/** The merged + validated policy with defaults applied (loader output). Same shape; all sections present. */
export type ResolvedPolicy = Required<Pick<Policy, "events" | "tracks" | "rules" | "intent" | "intent_rules" | "memory" | "router" | "render" | "cues" | "choices" | "timeline" | "visibility" | "checks" | "input" | "safety" | "fields" | "reflection" | "offscreen" | "scene" | "characters">> & Pick<Policy, "schema" | "x">;
