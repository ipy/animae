import type { CharacterId, EntityRef, EventId, JsonValue, Lod, NarrationStyle, SceneId, WorldTime } from "./types.ts";
import type { AppraiseBinding, ModeChangeReason, FallbackPhase, RenderBinding, RuntimeMode } from "./runtime/types.ts";

/**
 * Event catalog and documented extensions. CONTRACT file.
 * Payload shapes of the STATE-AFFECTING events; the reducer (timeline/reducer.ts) folds these into EngineState.
 * Emitters MUST produce exactly these shapes. Extra informational fields are allowed.
 */

export const EVENT_KINDS = [
  // input
  "input.received", "input.classified", "appraisal", "safety.flagged",
  // check
  "check.rolled",
  // rules (extension — reducer owner: timeline)
  "rule.window_opened", "rule.threshold_fired",
  // tracks
  "track.delta", "tier.changed",
  // fields
  "field.applied", "field.rejected", "field.cost_due", "field.cost_settled",
  "field.granted", "field.revoked", "field.age", // extension: runtime grant / revoke / ttl ticks (state-affecting)
  "info_arrival", // extension: knowledge/tag arrival (director anchor targets)
  // intent & generation
  "intent.decided", "intent.mismatch", "route.decided", "utterance", "narration", "choice.offered", "choice.taken", "choice.filtered",
  // memory
  "memory.written", "memory.distorted", "memory.propagated", "reflection.proposed", "reflection.accepted", "reflection.rejected",
  // entities
  "entity.generate", "entity.created", "entity.spawned", "entity.retired", "entity.alias_set", "character.promoted",
  "character.secret_unlocked", // extension: {character, secret} — a secret's `unlock` expression became true (permanent)
  // world
  "world.var_set", "time.advanced", "schedule.fired", "deck.drawn", "longevent.phase", "longevent.interrupted", "offscreen.simulated",
  "world.moved", // extension: player/character location change
  "item.moved", // extension
  "character.var_set", // extension: {id, key, value} — game rules set per-character vars
  // director
  "anchor.progress", "anchor.fulfilled", "anchor.fallback", "beat.entered", "beat.exited",
  "sidenote.added", "sidenote.expired", "sidenote.echoed", "exception.used",
  // visibility
  "visibility.granted", "visibility.expired",
  // timeline
  "branch.header", "branch.forked", "carry.applied", "purge.applied",
  // config & budget
  "config.reloaded", "config.warning", "config.error", "budget.degraded",
  // runtime backends (extension): mode switches and per-call fallbacks
  "runtime.mode_changed", "runtime.fallback_used",
  // scene lifecycle (extension)
  "scene.started", "scene.ended", "turn.started", "turn.ended",
  // gallery (extension — reducer no-op; collection file is authoritative)
  "gallery.unlocked", "gallery.captured", "gallery.rendered", "gallery.removed",
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export interface Appraisal {
  type: string; // key of policy.events.types (or "other")
  intensity: number; // 0..1
  sincerity: number; // 0..1
  approach?: string; // persuasion | deception | intimidation | performance | ... (policy-defined)
  claims: { s: string; p: string; o: string }[];
  search_terms: string[];
  tags: string[];
  input_class: "normal" | "injection_suspect" | "meta_probe";
  safety?: "none" | "self_harm" | "real_world_danger" | "sexual_minors" | "personal_crisis";
}

// ── payloads ──
export interface InputReceived { actor: CharacterId; addressee?: CharacterId; text: string; choiceId?: string }
export interface AppraisalEvent {
  actor: CharacterId;
  addressee: CharacterId;
  appraisal: Appraisal;
  /** Recording key of the S1 call that produced the appraisal; absent when the rule backend served it. */
  recording?: string;
}
export interface CheckRolled { id: string; expr: string; rolls: number[]; kept?: number[]; modifier: number; total: number; dc: number; success: boolean; margin: number; advantage?: boolean; disadvantage?: boolean; skill?: string; actor?: CharacterId; target?: CharacterId }

export interface RuleWindowOpened { id: string; owner: CharacterId; target?: CharacterId; untilScene: number; durationScenes: number }
export interface RuleThresholdFired { id: string; owner: CharacterId; target?: CharacterId }

/** owner = whose track; target = the counterpart for relation-scope tracks (absent for self-scope). */
export interface TrackDelta {
  owner: CharacterId; target?: CharacterId; track: string; delta: number; before: number; after: number;
  eventType?: string; factors?: Record<string, number>; clamped?: boolean; reason?: string;
}
export interface TierChanged { owner: CharacterId; target?: CharacterId; track: string; from: string | null; to: string | null; direction: "up" | "down" }

export interface FieldApplied { field: string; level: string; holder: string; effects: Record<string, unknown>; clamped?: string[]; owner?: CharacterId }
export interface FieldGranted { field: import("./schema/authored.ts").FieldDef }
export interface FieldRevoked { field: string }
export interface FieldCostDue { field: string; payer: string; dueScene?: SceneId }
export interface FieldCostSettled { field: string; payer: string; via: "paid" | "fallback" | "bypassed" }
export interface FieldAge { field: string; scenes?: number; turns?: number }
export interface InfoArrival { tags?: string[]; claim?: { s: string; p: string; o: string }; knowledge?: string; text?: string }

export interface IntentDecided { owner: CharacterId; intent: string; scores: Record<string, number>; forced?: boolean }
/**
 * Which backend serves each role for one turn. Authoritative for replay: an `llm` role needs a recording, a `rule` role
 * is recomputed deterministically. A later `runtime.fallback_used` of the same turn overrides the `render` binding.
 */
export interface RouteDecided {
  appraise: AppraiseBinding;
  render: RenderBinding;
  /** Router triggers that asked for the escalation tier (empty when none fired). */
  triggers: string[];
  /** `true` when the render runs on the escalation tier because a trigger fired and the budget allowed it. */
  escalated?: boolean;
  /** Sync calls the turn is entitled to: one S1 call and one S2 call on the named tier; zero for `rule` roles. */
  budget: { s1Calls: number; s2CallsByTier: Record<string, number> };
  degraded?: string[];
}
export interface BudgetDegraded {
  degraded?: string[];
  action?: string;
  kind_detail?: string;
  /** What the role was served by before and after the degrade action, for example `pro` → `standard` or `llm` → `rule`. */
  from?: string;
  to?: string;
  reason?: string;
}
/** Retrieval hits logged on `utterance` for introspection (no body text — replay-safe). */
export interface RetrievalLogHit {
  kind: "memory" | "knowledge";
  id: string;
  score: number;
  owner: CharacterId;
}

export interface Utterance {
  speaker: CharacterId;
  text: string;
  cues: { type: string; args: Record<string, unknown>; at: number }[];
  addressee?: CharacterId;
  intent?: string;
  autonomous?: boolean;
  /** Recording key of the S2 stream that produced the utterance; absent when the rule backend served it. */
  recording?: string;
  /** Render-time recall hits (ids/scores only). */
  retrieval?: RetrievalLogHit[];
}
/** Speaker-less narration paragraph (`style: "scene_break"` renders as a divider). */
export interface Narration {
  text: string;
  style?: NarrationStyle;
}
export interface RuntimeModeChanged {
  /** `null` for the first mode recorded on a timeline. */
  before: RuntimeMode | null;
  after: RuntimeMode;
  reason: ModeChangeReason;
  /** Who asked, for example `engine.runtime.setMode`, `cli:--mode`, `animae.yaml`. */
  trigger?: string;
}
export interface RuntimeFallbackUsed {
  phase: FallbackPhase;
  from: "llm";
  to: "rule";
  error: { code: string; message: string };
}

export interface MemoryWritten { owner: CharacterId; memoryId: string; kind: "episodic" | "semantic" | "summary" | "reflection"; importance: number; src?: EventId; path: string }
export interface MemoryDistorted { owner: CharacterId; memoryId: string; distortionKind: string }

/** Request event: fulfilled live inside the mutation gate (reducer no-op). */
export interface EntityGenerate {
  request: {
    kind: "character" | "location" | "item";
    template: string;
    id?: string;
    hints?: Record<string, JsonValue>;
    brief?: Record<string, JsonValue>;
  };
  reason?: string;
}
export interface EntityCreated { entity: EntityRef; template?: string; data: Record<string, JsonValue> }
export interface EntitySpawned {
  entity: EntityRef;
  /** full validated spawn spec (replay-safe) */
  spec: Record<string, JsonValue>;
  data: Record<string, JsonValue>;
  reason?: string;
  entitySeq?: number;
}
export interface EntityRetired { entity: EntityRef; reason?: string }
export interface EntityAliasSet {
  entity: CharacterId;
  nickname?: import("./state.ts").EntityAliasEntry | null;
  alias?: { key: string; label: string; by: CharacterId | "player" } | { key: string; remove: true };
  addressAs?: { target: CharacterId; label: string; by: CharacterId | "player" } | { target: CharacterId; remove: true };
}
export interface CharacterPromoted { id: CharacterId; from: Lod; to: Lod; /** newly added/updated character fields after promotion */ data?: Record<string, JsonValue> }

export interface WorldVarSet { path: string; value: JsonValue; previous?: JsonValue }
export interface TimeAdvanced { from: WorldTime; to: WorldTime; minutes: number; reason?: string }
export interface WorldMoved { who: CharacterId; from?: string; to: string }
export interface ItemMoved { item: string; to: EntityRef | null }
export interface ScheduleFired { id: string; at: WorldTime }
export interface DeckDrawn {
  deckId: string;
  entryId: string;
  weight: number;
  tags?: string[];
  candidates?: { id: string; weight: number; excluded?: string }[];
  at: WorldTime;
  entryOnce?: boolean;
}
export interface LongEventPhase { id: string; phase: string; index: number; startedAt: WorldTime }
export interface OffscreenSimulated { entity: EntityRef; from: WorldTime; to: WorldTime; fidelity: string }

export interface AnchorProgress { anchor: string; stage: "soft" | "hard" | "force"; detail?: string }
export interface AnchorFulfilled { anchor: string }
export interface AnchorFallback { anchor: string }
export interface BeatEntered { beat: string }
export interface BeatExited { beat: string }
export interface SidenoteAdded { npc: CharacterId; text: string; ttlTurns: number; verbatim: boolean; noteId: string }
export interface SidenoteExpired { npc: CharacterId; noteId: string }
/** Payload field is `exceptionId` (not envelope `id`). */
export interface ExceptionUsed { exceptionId: string; target: string; periodKey: string }

export interface VisibilityGranted { viewer: string; path: string; expiresAt?: WorldTime }
export interface VisibilityExpired { viewer: string; path: string }

export interface SceneStarted { sceneId: SceneId; location: string; participants: CharacterId[]; fields: string[] }
export interface SceneEnded { sceneId: SceneId; turns: number }

export interface ReflectionAccepted { owner: CharacterId; summaries: string[]; goal_changes: unknown[]; new_claims: { s: string; p: string; o: string }[] }
export interface ModConfigRecord { id: string; version: string; contentHash: string }
export interface ConfigReloaded { hash: string; previous?: string; mods?: ModConfigRecord[] }

export interface CharacterVarSet { id: CharacterId; key: string; value: JsonValue }
/** A secret of `id` (authored in `secrets.yaml`) whose `unlock` expression became true; unlocking is permanent. */
export interface CharacterSecretUnlocked { character: CharacterId; secret: string }
