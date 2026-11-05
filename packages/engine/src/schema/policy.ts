import { z } from "zod";
import { Cel, CelOrBool, CelOrNumber, EventDraftSchema, Id, LevelSchema, LodSchema } from "./common.ts";
import { FieldDescriptorSchema } from "./authored.ts";
import { CustomRuleSchema } from "./custom-rule.ts";

/**
 * Policy schema (tracks, checks, rules, retrieval, models). CONTRACT file.
 * A "policy" document is a (partial) policy; the loader deep-merges many documents into one validated `Policy`.
 * Merge conventions (implemented by policy/merge): records merge by key; arrays REPLACE, unless written as
 * `{ $append: [...] }` / `{ $prepend: [...] }` which concatenate to the earlier layer's array. The same markers with a
 * string payload concatenate to the earlier layer's string (for prompt prose blocks).
 */

const Rec = <T extends z.ZodType>(v: T) => z.record(z.string(), v);

export const TierSchema = z.strictObject({ name: z.string(), from: z.number(), label: z.string().optional() });

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

// ───────────────────────── rule backend (token-free S1/S2 stand-ins) ─────────────────────────
const UnitInterval = z.number().min(0).max(1);

/** One cue a template line attaches to its text. Same shape the render stage validates against `cues.types`. */
export const RuleCueSchema = z.strictObject({
  type: z.string(),
  args: z.record(z.string(), z.unknown()).default({}),
  /** character offset into the rendered text; 0 when omitted */
  at: z.number().int().min(0).optional(),
});

/**
 * One line of a template pool. `text` may contain `{{ CEL }}` placeholders and `$t:key` string-table keys; the pick is
 * weighted and seeded (see the rule backend). A `narration` / `narration_break` line is emitted as a speaker-less
 * narration instead of an utterance.
 */
export const RulePoolEntrySchema = z.strictObject({
  text: z.string().min(1),
  weight: z.number().positive().default(1),
  cues: z.array(RuleCueSchema).default([]),
  /** intent this line realizes; backfills `intent_realized` (the rule backend never produces `intent.mismatch`) */
  intent: z.string().optional(),
  style: z.enum(["narration", "narration_break"]).optional(),
});
export type RulePoolEntry = z.infer<typeof RulePoolEntrySchema>;

/** A template layer: the first layer whose `when` holds supplies the utterance; narration layers add paragraphs. */
export const RuleLayerSchema = z.strictObject({
  id: Id,
  when: Cel.default("true"),
  pool: z.array(RulePoolEntrySchema).min(1),
});
export type RuleLayer = z.infer<typeof RuleLayerSchema>;

/** What the rule renderer says when no layer matches. */
export const RuleFallbackSchema = z.strictObject({
  text: z.string().min(1),
  cues: z.array(RuleCueSchema).default([]),
  intent: z.string().optional(),
});
export type RuleFallback = z.infer<typeof RuleFallbackSchema>;

const AppraiseEventSchema = z.strictObject({
  type: z.string(),
  intensity: UnitInterval.default(0.5),
  sincerity: UnitInterval.default(0.7),
  approach: z.string().optional(),
  tags: z.array(z.string()).default([]),
});

const RouterBudgetTierCaps = z.record(z.string(), z.number().int().min(0));
const MaxOutputTokens = z.strictObject({
  s1: z.number().int().positive().default(400),
  /** one cap for every S2 tier, or a cap per tier id (tiers not listed use `default`, then 800) */
  s2: z
    .union([
      z.number().int().positive(),
      z.record(z.string(), z.number().int().positive()),
    ])
    .default(800),
});

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

  /**
   * Rule backend appraisal, in priority order: a taken choice's own metadata, `/<event> [intensity|tag]` commands,
   * `patterns`, then `fallback`. `inputClass` extends the injection / meta-probe keyword tables.
   */
  appraise: z
    .strictObject({
      patterns: z.array(z.strictObject({ match: z.string(), flags: z.string().regex(/^[imsu]*$/).optional(), event: AppraiseEventSchema })).optional(),
      fallback: AppraiseEventSchema.optional(),
      /** command word → event type id (a command word that is itself an event type id needs no entry) */
      commands: z.record(z.string(), z.string()).optional(),
      inputClass: z
        .strictObject({
          /** regular-expression sources (case-insensitive) that mark an injection attempt */
          injection: z.array(z.string()).optional(),
          /** regular-expression sources (case-insensitive) that mark a question about the model or its prompt */
          metaProbe: z.array(z.string()).optional(),
        })
        .optional(),
    })
    .optional(),

  memory: z
    .strictObject({
      weights: z.strictObject({ term: z.number(), recency: z.number(), importance: z.number(), salience: z.number(), vector: z.number() }).partial().optional(),
      k: z.number().int().positive().optional(),
      recencyHalfLifeDays: z.number().positive().optional(),
      indexMax: z.number().int().positive().optional(),
      write: z.strictObject({ episodic: z.boolean().default(true), minIntensity: z.number().min(0).max(1).default(0.2), maxChars: z.number().int().positive().default(240) }).optional(),
      /**
       * How the text and weights of an episodic memory are produced. `rule` (default) fills `template`; `s1` asks the
       * structured-judgment role and falls back to `template` when that role is served by the rule backend or fails.
       * `narration` decides whether speaker-less narration reaches the characters' memories.
       */
      writing: z
        .strictObject({
          backend: z.enum(["rule", "s1"]).default("rule"),
          /** `{{ CEL }}` template; `text` is the utterance text, `speaker` its speaker id */
          template: z.string().default("{{text}}"),
          importanceByEventType: z.record(z.string(), UnitInterval).default({}),
          valenceByEventType: z.record(z.string(), z.number().min(-1).max(1)).default({}),
          narration: z.enum(["none", "inject_belief", "shareable"]).default("none"),
        })
        .optional(),
      forgetting: z.strictObject({ enabled: z.boolean().default(false), tau: z.number().positive().default(30), threshold: z.number().min(0).max(1).default(0.2) }).optional(),
      distortion: z
        .strictObject({
          enabled: z.boolean().default(false),
          p: z.number().min(0).max(1).default(0.1),
          maxImportance: z.number().min(0).max(1).default(0.7),
          kinds: z.array(z.enum(["intensify", "swap_subject", "add_motive"])).default(["intensify"]),
        })
        .optional(),
      propagation: z
        .strictObject({
          enabled: z.boolean().default(false),
          onTick: z.enum(["day", "scene_end"]).default("day"),
          distortionPerHop: z.number().min(0).default(1),
        })
        .optional(),
    })
    .optional(),

  reflection: z
    .strictObject({
      enabled: z.boolean().default(true),
      accept: Cel.default("!conflict"),
      /** `s1` follows the S1 role (LLM when it is served by one); `rule` always writes `summaryTemplate` */
      backend: z.enum(["s1", "rule"]).optional(),
      /** `{{ CEL }}` template for the one summary line the rule backend writes; empty goal changes and claims */
      summaryTemplate: z.string().optional(),
    })
    .optional(),

  characters: z
    .strictObject({
      lod: z.strictObject({ promote: z.array(z.strictObject({ from: LodSchema, to: LodSchema, when: Cel })).optional() }).optional(),
    })
    .optional(),

  offscreen: z
    .strictObject({
      fidelity: z.strictObject({ default: FidelitySchema.default("rule"), locations: Rec(FidelitySchema).default({}), characters: Rec(FidelitySchema).default({}) }),
      /** `{{ CEL }}` template of the trace the rule backend writes for an offscreen location (`location.name`, `time`) */
      narrateTemplate: z.string().optional(),
    })
    .optional(),

  scene: z
    .strictObject({
      turnTaking: z.union([z.enum(["addressed", "round_robin"]), z.strictObject({ priority: Cel })]).optional(),
      autonomous: z
        .strictObject({
          maxExchangesPerPlayerTurn: z.number().int().min(0).default(0),
          when: Cel.default("true"),
          /** template layers for autonomous exchanges under the rule backend (same shape as `render.layers`) */
          rules: z.array(RuleLayerSchema).optional(),
        })
        .optional(),
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
          /** sync model calls a turn may make: one S1 (appraise) plus one S2 (render) */
          syncCallsPerTurn: z.number().int().positive().default(2),
          /** S1 calls per turn; 0 serves the S1 role with the rule backend */
          s1PerTurn: z.number().int().min(0).optional(),
          /** S2 calls per turn for a tier that is not listed in `s2PerTurnByTier`; 0 disables the tier */
          s2PerTurn: z.number().int().min(0).default(1),
          /** S2 calls per turn, per tier id */
          s2PerTurnByTier: RouterBudgetTierCaps.optional(),
          /** share of turns allowed on tiers above the default tier */
          s2Ratio: z.number().min(0).max(1).default(0.15),
          s2ReservedForAnchors: z.number().min(0).max(1).default(0.03),
          maxOutputTokens: MaxOutputTokens.default({ s1: 400, s2: 800 }),
          /** shared pool of above-default-tier calls per scene; default derived from s2Ratio */
          sceneS2Pool: z.number().int().min(0).optional(),
        })
        .optional(),
      degrade: z
        .array(z.enum(["s2_tier_down", "s2_to_rule", "s1_to_rule", "defer_reflection", "skip_offscreen_narrate", "skip_autonomous"]))
        .optional(),
    })
    .optional(),

  render: z
    .strictObject({
      retryOnMismatch: z.union([z.literal(0), z.literal(1)]).default(0),
      recentTurns: z.number().int().positive().default(12),
      temperature: z.number().optional(),
      /** Optional per-segment character caps (section-aware drop); unlimited when omitted. */
      maxSegmentChars: z
        .strictObject({
          static: z.number().int().positive().optional(),
          semiStatic: z.number().int().positive().optional(),
          dynamic: z.number().int().positive().optional(),
        })
        .optional(),
      /** Max lines in the on-demand knowledge index (S2 with tools only). */
      knowledgeIndexMax: z.number().int().positive().optional(),
      /**
       * How the compact relation line in prompts is built. All keys are optional: by default every relation-scope track
       * is a candidate (in policy order) and every tier is shown.
       */
      relation: z
        .strictObject({
          /** Ordered track ids the line may show (others are ignored). */
          tracks: z.array(z.string()).optional(),
          /** At most this many tracks per line (default 3). */
          maxTracks: z.number().int().positive().optional(),
          /** Track id to tier names left out of the line; by default the tier a track starts in (the one holding `initial`) is left out. */
          silentTiers: Rec(z.array(z.string())).optional(),
          /** Tracks consulted for behavioral directives (`x.tier_directives`); defaults to `tracks`. Tracks that moved furthest from their starting tier win. */
          directiveTracks: z.array(z.string()).optional(),
          /** At most this many directives per relation line (default 1). */
          maxDirectives: z.number().int().positive().optional(),
        })
        .optional(),
      /**
       * How much recalled material the dynamic prompt segment carries. Retrieval can return many loosely related
       * documents; these caps keep the prompt to what the turn needs.
       */
      recall: z
        .strictObject({
          /** At most this many recalled knowledge documents (default 3); recalled memories are not capped here. */
          maxKnowledge: z.number().int().nonnegative().optional(),
          /** Each recalled knowledge document is cut at a sentence boundary near this many characters (default 280). */
          knowledgeChars: z.number().int().positive().optional(),
          /** Each recalled memory is cut near this many characters (default 400). */
          memoryChars: z.number().int().positive().optional(),
        })
        .optional(),
      /**
       * Rule backend: template layers. The first layer whose `when` holds supplies the utterance; layers whose pool
       * holds `narration` / `narration_break` lines add narration paragraphs and do not compete for the utterance.
       */
      layers: z.array(RuleLayerSchema).optional(),
      /** Rule backend: what to say when no utterance layer matches. */
      fallback: RuleFallbackSchema.optional(),
    })
    .optional(),
  cues: z.strictObject({ types: Rec(z.strictObject({ args: Rec(FieldDescriptorSchema).default({}), description: z.string().optional() })) }).optional(),
  choices: z
    .strictObject({
      enabled: z.boolean().default(false),
      count: z.number().int().positive().default(3),
      filter: Cel.default("true"),
      /**
       * Rule backend: quick replies. Matching rules (in order, at most `count`) become the offered choices; `event_type`,
       * `tags`, `intensity`, `sincerity` and `approach` are what the choice appraises to when it is taken.
       */
      rules: z
        .array(
          z.strictObject({
            id: Id.optional(),
            when: Cel.default("true"),
            text: z.string().min(1),
            event_type: z.string(),
            tags: z.array(z.string()).default([]),
            intensity: UnitInterval.optional(),
            sincerity: UnitInterval.optional(),
            approach: z.string().optional(),
          }),
        )
        .optional(),
    })
    .optional(),

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
export type ResolvedPolicy = Required<Pick<Policy, "events" | "tracks" | "rules" | "intent" | "intent_rules" | "memory" | "router" | "render" | "cues" | "choices" | "timeline" | "visibility" | "checks" | "input" | "safety" | "fields" | "reflection" | "offscreen" | "scene" | "characters" | "appraise">> & Pick<Policy, "schema" | "x">;
