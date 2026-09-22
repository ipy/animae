import { z } from "zod";
import { Cel, CelOrBool, CelOrNumber, EntityRefSchema, EventDraftSchema, Id, LevelSchema, LodSchema, Tags, WorldTimeSchema } from "./common.ts";

/**
 * Zod schemas of AUTHORED files (config, characters, fields, director, schedule). CONTRACT file.
 * YAML field names are snake_case where the spec uses them (bottom_lines, style_examples ...).
 */

// ───────────────────────── animae.yaml ─────────────────────────
export const ModelSpecSchema = z.strictObject({
  provider: z.enum(["anthropic", "openai", "google", "deepseek", "ollama", "openai-compatible"]),
  model: z.string(),
  /** custom API origin (anthropic: fallback env ANTHROPIC_BASE_URL; ollama: default http://127.0.0.1:11434) */
  baseURL: z.string().optional(),
  /** name of the env var holding the key; default per provider (ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY, OPENAI_COMPATIBLE_API_KEY) */
  apiKeyEnv: z.string().optional(),
  /** explicit key (discouraged; prefer env) */
  apiKey: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  /** provider-specific options forwarded as providerOptions[provider] */
  options: z.record(z.string(), z.unknown()).optional(),
  /** openai-compatible: provider display name */
  name: z.string().optional(),
  /** Capability tags forwarded to the model port (CEL `model.tags`). */
  tags: z.array(z.string()).optional(),
});
export type ModelSpec = z.infer<typeof ModelSpecSchema>;

export const I18nConfigSchema = z.strictObject({
  /** UI / CLI / player-facing locale (BCP-47) */
  locale: z.string().default("en"),
  /** LLM-internal prompt template locale (static prompt resources) */
  promptLocale: z.string().default("zh-CN"),
  /** player-facing generated text locale; defaults to `locale` */
  outputLocale: z.string().optional(),
  /** LLM-facing authored overlay locale; defaults to `promptLocale` at resolve time */
  contentLocale: z.string().optional(),
  /** last-resort catalog locale */
  fallbackLocale: z.string().default("en"),
});
export type I18nConfig = z.infer<typeof I18nConfigSchema>;

export const AnimaeConfigSchema = z.strictObject({
  preset: z.string().optional(),
  seed: z.number().int().default(0),
  models: z.strictObject({ s1: ModelSpecSchema, s2: ModelSpecSchema }).optional(),
  policies: z.array(z.string()).default([]),
  /** enabled content mod ids (see docs/mods.md); host may override via createEngine({ mods }) */
  mods: z.array(z.string()).default([]),
  i18n: I18nConfigSchema.optional(),
});
/** Parsed config always includes `mods` (default `[]`); `mods?` on the type keeps test/fixture literals valid. */
export type AnimaeConfig = Omit<z.infer<typeof AnimaeConfigSchema>, "mods"> & { mods?: string[] };

// ───────────────────────── world/world.yaml ─────────────────────────
export const CalendarSchema = z.strictObject({
  units: z.strictObject({ minute: z.number().default(1), hour: z.number().default(60), day: z.number().default(1440) }).default({ minute: 1, hour: 60, day: 1440 }),
  sceneMinutes: z.number().int().positive().default(30),
  turnMinutes: z.number().int().min(0).default(1),
  chapters: z.array(z.strictObject({ id: Id, days: z.tuple([z.number().int(), z.number().int()]), title: z.string().optional() })).default([]),
  /** optional names for display, e.g. weekdays */
  weekdays: z.array(z.string()).optional(),
});
export type Calendar = z.infer<typeof CalendarSchema>;

export const WorldDefSchema = z.strictObject({
  title: z.string().optional(),
  /** BCP 47 */
  language: z.string().default("en"),
  calendar: CalendarSchema.default(CalendarSchema.parse({})),
  start: WorldTimeSchema.default({ day: 1, minute: 480 }),
  /** initial world variables. A var may be tagged public via `public_vars` for the `player` viewer */
  vars: z.record(z.string(), z.unknown()).default({}),
  public_vars: z.array(z.string()).default([]),
  /** world-rules text injected into the static prompt segment */
  rules_text: z.string().optional(),
  /** starting location of the player */
  start_location: z.string().optional(),
  /** id of the player character entity (default "player") */
  player: z.string().default("player"),
  factions: z.record(z.string(), z.strictObject({ name: z.string(), summary: z.string().optional(), vars: z.record(z.string(), z.unknown()).default({}) })).default({}),
});
export type WorldDef = z.infer<typeof WorldDefSchema>;

export const LocationDefSchema = z.strictObject({
  id: Id,
  name: z.string(),
  summary: z.string().default(""),
  description: z.string().optional(),
  tags: Tags,
  connects: z.array(z.strictObject({ to: Id, minutes: z.number().int().min(0).default(5), label: z.string().optional() })).default([]),
  vars: z.record(z.string(), z.unknown()).default({}),
  /** default offscreen fidelity override hint (policy wins) */
  x: z.record(z.string(), z.unknown()).optional(),
});
export type LocationDef = z.infer<typeof LocationDefSchema>;

export const ItemDefSchema = z.strictObject({
  id: Id,
  name: z.string(),
  summary: z.string().default(""),
  tags: Tags,
  holder: EntityRefSchema.optional(),
  vars: z.record(z.string(), z.unknown()).default({}),
});
export type ItemDef = z.infer<typeof ItemDefSchema>;

// ───────────────────────── fields ─────────────────────────
export const FIELD_EFFECT_KEYS_BY_LEVEL = {
  L0: ["world_vars", "event_prob", "salience", "topic_access", "schedule_offset"],
  L1: ["track_mult", "track_offset", "track_caps", "tier_shift", "check_mod"],
  L2: ["intent_force", "intent_forbid", "intent_bias"],
  L3: ["rule_override", "rule_add"],
  L4: ["hide_entities", "disguise", "inject_belief", "suppress_memory_tags"],
} as const;

const Effects = z.strictObject({
  // L0
  world_vars: z.record(z.string(), z.unknown()).optional(),
  event_prob: z.record(z.string(), z.number()).optional(),
  salience: z.array(z.strictObject({ tags: z.array(z.string()), boost: z.number() })).optional(),
  topic_access: z.strictObject({ open: z.array(z.string()).default([]), close: z.array(z.string()).default([]) }).optional(),
  schedule_offset: z.record(z.string(), z.number()).optional(),
  // L1   track_mult: {track: {eventType|"*": m}}
  track_mult: z.record(z.string(), z.record(z.string(), z.number())).optional(),
  track_offset: z.record(z.string(), z.number()).optional(),
  track_caps: z.record(z.string(), z.strictObject({ min: z.number().optional(), max: z.number().optional() })).optional(),
  tier_shift: z.record(z.string(), z.number().int()).optional(),
  check_mod: z.record(z.string(), z.strictObject({ bonus: z.number().default(0), advantage: z.enum(["advantage", "disadvantage"]).optional() })).optional(),
  // L2
  intent_force: z.string().optional(),
  intent_forbid: z.array(z.string()).optional(),
  intent_bias: z.record(z.string(), z.number()).optional(),
  // L3
  rule_override: z.record(z.string(), z.string()).optional(),
  rule_add: z.array(z.record(z.string(), z.unknown())).optional(),
  // L4
  hide_entities: z.array(z.string()).optional(),
  disguise: z.record(z.string(), z.string()).optional(),
  inject_belief: z.array(z.strictObject({ text: z.string(), tags: Tags, claims: z.array(z.strictObject({ s: z.string(), p: z.string(), o: z.string() })).default([]) })).optional(),
  suppress_memory_tags: z.array(z.string()).optional(),
});
export type FieldEffects = z.infer<typeof Effects>;

export const FieldDefSchema = z
  .strictObject({
    id: Id,
    holder: EntityRefSchema,
    source: z.enum(["author", "rule", "anchor", "runtime"]).default("author"),
    scope: z
      .strictObject({
        scene: z.string().optional(),
        location: z.string().optional(),
        turns: z.number().int().positive().optional(),
        time: z.strictObject({ from: WorldTimeSchema, to: WorldTimeSchema }).optional(),
        when: Cel.optional(),
        /** only affects these characters (owner/target of the interaction); empty = all */
        characters: z.array(z.string()).optional(),
      })
      .default({}),
    level: LevelSchema,
    effects: Effects,
    priority: z.number().default(0),
    stacking: z.string().regex(/^(add|max|override|resolver:.+)$/).default("add"),
    cost: z
      .strictObject({
        payer: z.string(),
        effects: Effects.optional(),
        events: z.array(EventDraftSchema).optional(),
        due: Cel.optional(),
        ttlScenes: z.number().int().positive().default(3),
        fallback: z.strictObject({ effects: Effects.optional(), events: z.array(EventDraftSchema).optional() }).optional(),
      })
      .optional(),
    description: z.string().optional(),
  })
  .superRefine((f, ctx) => {
    const allowed = new Set<string>(FIELD_EFFECT_KEYS_BY_LEVEL[f.level]);
    for (const [k, v] of Object.entries(f.effects)) {
      if (v !== undefined && !allowed.has(k)) ctx.addIssue({ code: "custom", path: ["effects", k], message: `effect "${k}" does not belong to level ${f.level}` });
    }
  });
export type FieldDef = z.infer<typeof FieldDefSchema>;

// ───────────────────────── director ─────────────────────────
export const AnchorDefSchema = z.strictObject({
  id: Id,
  title: z.string().optional(),
  target: z.strictObject({
    kind: z.enum(["world_event", "info_arrival", "character_state", "character_choice"]),
    /** world_event: {event: <kind>, match?: <CEL>} | info_arrival: {tags|claim|knowledge} | character_state: {character, when: <CEL>} | character_choice: {character, choice: <tag>} */
    spec: z.record(z.string(), z.unknown()),
  }),
  /** WorldTime or CEL expression evaluating to an absolute minute number or bool */
  deadline: z.union([WorldTimeSchema, Cel]),
  strategies: z.array(z.enum(["soft", "hard", "force"])).default(["soft", "hard"]),
  soft: z.lazy(() => FieldDefSchema).optional(),
  hard: z.array(EventDraftSchema).default([]),
  force: z.lazy(() => FieldDefSchema).optional(),
  /** characters/knowledge this anchor references (keeps them promoted / S2-routed) */
  refs: z.array(z.string()).default([]),
});
export type AnchorDef = z.infer<typeof AnchorDefSchema>;

export const AnchorsFileSchema = z.array(AnchorDefSchema);

export const BeatDefSchema = z.strictObject({
  id: Id,
  title: z.string().optional(),
  enter: Cel,
  exit: Cel,
  fields: z.array(z.string()).default([]),
  /** text injected into the dynamic prompt segment while the beat is active */
  note: z.string().optional(),
});
export type BeatDef = z.infer<typeof BeatDefSchema>;
export const BeatsFileSchema = z.array(BeatDefSchema);

export const ExceptionDefSchema = z.strictObject({
  id: Id,
  charges: z.number().int().min(0),
  period: z.enum(["session", "day", "chapter"]),
  mayBypass: z.array(z.string().regex(/^(field_cap|cost_due|track_cap|rule:.+|constraint:.+)$/)),
});
export type ExceptionDef = z.infer<typeof ExceptionDefSchema>;
export const ExceptionsFileSchema = z.array(ExceptionDefSchema);

// ───────────────────────── schedule ─────────────────────────
export const ScheduleItemSchema = z
  .strictObject({
    id: Id,
    /** one-shot: WorldTime or "day 3 08:00" */
    at: z.union([WorldTimeSchema, z.string().regex(/^day \d+( \d{1,2}:\d{2})?$/)]).optional(),
    /** periodic: "day 08:00" (daily at) | "hour" | "every 30m" | "day 08:00" */
    every: z.string().optional(),
    emit: z.union([EventDraftSchema, z.array(EventDraftSchema)]).optional(),
    rule: z.string().optional(),
    /** long event total minutes */
    duration: z.number().int().positive().optional(),
    phases: z.array(z.strictObject({ id: Id, minutes: z.number().int().positive() })).optional(),
    onInterrupt: z.string().optional(),
    /** CEL guard: skipped when false */
    when: Cel.optional(),
    /** limit participants of a long event / scheduled encounter */
    characters: z.array(z.string()).optional(),
    location: z.string().optional(),
  })
  .superRefine((s, ctx) => {
    if (!s.at && !s.every) ctx.addIssue({ code: "custom", message: "schedule item needs `at` or `every`" });
    if (!s.emit && !s.rule) ctx.addIssue({ code: "custom", message: "schedule item needs `emit` or `rule`" });
  });
export type ScheduleItem = z.infer<typeof ScheduleItemSchema>;
export const ScheduleFileSchema = z.array(ScheduleItemSchema);

// ───────────────────────── knowledge ─────────────────────────
export const KnowledgeFrontmatterSchema = z
  .strictObject({
    name: z.string(),
    description: z.string().default(""),
    scope: z.string().regex(/^(world|location:.+|character:.+|scene:.+)$/).default("world"),
    inject: z.enum(["always", "when", "on-demand"]).default("on-demand"),
    when: Cel.optional(),
    tags: Tags,
    priority: z.number().default(0),
    /** engine: shareable memory/knowledge for propagation */
    shareable: z.boolean().default(false),
  })
  .superRefine((k, ctx) => {
    if (k.inject === "when" && !k.when) ctx.addIssue({ code: "custom", path: ["when"], message: "`when` is required when inject: when" });
  });
export type KnowledgeFrontmatter = z.infer<typeof KnowledgeFrontmatterSchema>;
export interface KnowledgeDoc extends KnowledgeFrontmatter {
  /** unique doc id: "world/<relpath>" or "character:<id>/<file>" */
  id: string;
  body: string;
  /** file path relative to the data root */
  path: string;
  /** owning character id for character knowledge */
  owner?: string;
}

// ───────────────────────── characters ─────────────────────────
export const BottomLineSchema = z.strictObject({ id: Id, text: z.string(), tags: Tags, hardness: z.enum(["hard", "soft"]).default("soft") });

export const CardFrontmatterSchema = z.looseObject({
  identity: z.looseObject({
    id: Id.optional(), // defaults to directory name
    name: z.string(),
    summary: z.string().default(""),
    language: z.string().optional(),
    style_examples: z.array(z.string()).default([]),
    greeting: z.string().optional(),
    /** display hints for the UI */
    nickname: z.string().optional(),
    color: z.string().optional(),
  }),
  constraints: z
    .strictObject({ motives: z.array(z.string()).default([]), bottom_lines: z.array(BottomLineSchema).default([]), taboos: z.array(z.string()).default([]) })
    .default({ motives: [], bottom_lines: [], taboos: [] }),
  lod: LodSchema.default("principal"),
  tags: Tags,
  /** style prompt (writing voice) */
  style: z.string().optional(),
  x_import: z.unknown().optional(),
});
export type CardFrontmatter = z.infer<typeof CardFrontmatterSchema>;

export const TraitsFileSchema = z.looseObject({
  event_mult: z.record(z.string(), z.number()).default({}),
});
export type TraitsFile = z.infer<typeof TraitsFileSchema>;

/** tracks.yaml: initial values & per-character overrides. */
export const TracksFileSchema = z.strictObject({
  /** character-scope ("self") track initial values */
  self: z.record(z.string(), z.number()).default({}),
  /** relation-scope initial values toward a specific target: {playerId: {affinity: 70}} ; "*" = default target (the player) */
  toward: z.record(z.string(), z.record(z.string(), z.number())).default({}),
  /** per-character overrides of track definition fields (min,max,decay...) */
  overrides: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
});
export type TracksFile = z.infer<typeof TracksFileSchema>;

export const GoalSchema = z.strictObject({ id: Id, text: z.string(), tags: Tags, priority: z.number().default(0) });
export const GoalsFileSchema = z.array(GoalSchema);
export type Goal = z.infer<typeof GoalSchema>;

export const SecretSchema = z.strictObject({ id: Id, text: z.string(), tags: Tags, unlock: Cel.default("false") });
export const SecretsFileSchema = z.array(SecretSchema);
export type Secret = z.infer<typeof SecretSchema>;

export const RelationSchema = z.strictObject({
  to: z.string(),
  kind: z.string(),
  tracks: z.record(z.string(), z.number()).optional(),
  share: Cel.default("false"),
  note: z.string().optional(),
});
export const RelationsFileSchema = z.array(RelationSchema);
export type Relation = z.infer<typeof RelationSchema>;

/** Fully loaded character definition (authored or generated). */
export interface CharacterDef {
  id: string;
  /** "authored" (characters/) | "generated" (timelines/<branch>/entities/) */
  origin: "authored" | "generated";
  card: CardFrontmatter;
  /** persona body of card.md */
  persona: string;
  traits: TraitsFile;
  tracks: TracksFile;
  goals: Goal[];
  secrets: Secret[];
  relations: Relation[];
  knowledge: KnowledgeDoc[];
}

// ───────────────────────── templates ─────────────────────────
export const TemplateSchema = z.strictObject({
  id: Id.optional(),
  kind: z.enum(["character", "location", "item"]).optional(),
  /** zod-compatible field definitions of the structured proposal: name -> descriptor */
  fields: z.record(z.string(), z.lazy(() => FieldDescriptorSchema)),
  guidance: z.string().default(""),
  defaults: z.record(z.string(), z.unknown()).default({}),
  /** promotion rules: [{to: lod, when: <CEL>}] */
  promote: z.array(z.strictObject({ from: LodSchema.optional(), to: LodSchema, when: Cel })).default([]),
  lod: LodSchema.optional(),
});
export type Template = z.infer<typeof TemplateSchema>;

export type FieldDescriptor =
  | { type: "string" | "number" | "integer" | "boolean"; description?: string; min?: number; max?: number; enum?: (string | number)[]; default?: unknown; optional?: boolean }
  | { type: "array"; items: FieldDescriptor; description?: string; optional?: boolean; max?: number }
  | { type: "object"; fields: Record<string, FieldDescriptor>; description?: string; optional?: boolean };
export const FieldDescriptorSchema: z.ZodType<FieldDescriptor> = z.lazy(() =>
  z.union([
    z.strictObject({
      type: z.enum(["string", "number", "integer", "boolean"]),
      description: z.string().optional(),
      min: z.number().optional(),
      max: z.number().optional(),
      enum: z.array(z.union([z.string(), z.number()])).optional(),
      default: z.unknown().optional(),
      optional: z.boolean().optional(),
    }),
    z.strictObject({ type: z.literal("array"), items: FieldDescriptorSchema, description: z.string().optional(), optional: z.boolean().optional(), max: z.number().optional() }),
    z.strictObject({ type: z.literal("object"), fields: z.record(z.string(), FieldDescriptorSchema), description: z.string().optional(), optional: z.boolean().optional() }),
  ]),
) as z.ZodType<FieldDescriptor>;

/** Everything loaded from the data root's authored files (+ branch entities merged by timeline). */
export interface Authored {
  config: AnimaeConfig;
  world: WorldDef;
  locations: Record<string, LocationDef>;
  items: Record<string, ItemDef>;
  fields: Record<string, FieldDef>;
  anchors: AnchorDef[];
  beats: BeatDef[];
  exceptions: Record<string, ExceptionDef>;
  schedule: ScheduleItem[];
  /** weighted random event decks (`world/decks/*.yaml`) */
  decks?: import("./decks.ts").DeckDef[];
  /** world knowledge only; character knowledge lives in CharacterDef.knowledge */
  knowledge: KnowledgeDoc[];
  characters: Record<string, CharacterDef>;
  templates: { character: Record<string, Template>; location: Record<string, Template>; item: Record<string, Template> };
  /** sha256 of all authored file contents (hot-reload comparison) */
  hash: string;
  /** per-file hashes: path -> sha256 */
  files: Record<string, string>;
  /** resolved enabled mods (empty if none) */
  mods?: import("../mod.ts").ResolvedMod[];
  /** logical path -> layer that supplied merged content (after layered load) */
  modProvenance?: Record<string, import("../mod.ts").ModProvenanceEntry>;
  /** missing $t: keys and string-table problems (non-fatal) */
  localeWarnings?: string[];
}
