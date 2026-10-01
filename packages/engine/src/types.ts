/**
 * Core shared types of the Animae engine. This file is a CONTRACT: modules import from here.
 * Changes must be additive and documented in docs/architecture.md ("Contract changelog").
 */

export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

export type EventId = string; // "evt_0001" — unique within an ancestor chain
export type SceneId = string; // "scn_0001"
export type TurnId = string; // "turn_0001"
export type CharacterId = string;
export type BranchName = string;

/** Absolute in-world time. `minute` is minutes since 00:00 of `day` (day starts at 1). */
export interface WorldTime {
  day: number;
  minute: number;
}

/** Duration accepted by the public API. string forms: "90m", "2h", "1d", "1d2h30m". number = minutes. */
export type Duration = number | string | { days?: number; hours?: number; minutes?: number };

export type Lod = "extra" | "supporting" | "principal";

/** Built-in viewers: debug | author | gm | player | npc:<id>. Custom viewers are arbitrary strings. */
export type Viewer = "debug" | "author" | "gm" | "player" | `npc:${string}` | (string & {});

export interface EventBase {
  id: EventId;
  kind: string;
  t: WorldTime;
  /** session id (one engine run) */
  sid: string;
  scene?: SceneId;
  turn?: TurnId;
  /** who produced it: "rule:<id>", "field:<id>", "proposal:<stage>", "external:<caller>", "engine" ... */
  source: string;
  /** referenced event ids or field paths */
  because: string[];
}

/** A persisted event: base envelope + flattened payload. */
export type EngineEvent<P extends object = Record<string, unknown>> = EventBase & P;

/** What modules emit. `timeline.append` fills id/t/sid/scene/turn. */
export type EventDraft<P extends object = Record<string, unknown>> = {
  kind: string;
  source?: string;
  because?: string[];
  /** override the event time (defaults to current world time) */
  t?: WorldTime;
} & P;

export interface BranchRef {
  name: BranchName;
  parent?: BranchName;
  forkAt?: EventId;
}

export interface SaveSlot {
  label: string;
  branch: BranchName;
  eventId: EventId;
  createdAt: string; // ISO wall-clock
  worldTime?: WorldTime;
}

export type TurnChunk =
  | {
      type: "text";
      text: string;
      speaker?: CharacterId;
      autonomous?: boolean;
      /** When true, begins a new utterance even if the speaker matches the previous `text` chunk (same sub-turn). */
      newUtterance?: boolean;
    }
  | { type: "cue"; cue: { type: string; args: Record<string, unknown> }; at: number; speaker?: CharacterId }
  | { type: "choices"; choices: Choice[] }
  /** one `done` per processed (sub-)turn: the player's turn plus each NPC-autonomous exchange ends with its own `done`; the AsyncIterable completes after the last */
  | { type: "done"; turnId: TurnId; events: EventId[]; speaker?: CharacterId };

export interface Choice {
  id: string;
  text: string;
  expected_event_type: string;
  tags: string[];
}

export interface EntityRef {
  kind: "character" | "location" | "item";
  id: string;
}

export interface Rng {
  /** [0,1) */
  next(): number;
  /** integer in [min,max] inclusive */
  int(min: number, max: number): number;
  pick<T>(xs: readonly T[]): T;
}

/** Optional presentation payload for localizing at the UI/protocol edge. */
export interface AnimaeErrorPresentation {
  messageKey?: string;
  params?: Record<string, JsonValue>;
  namespace?: string;
}

/** Errors thrown by the engine are AnimaeError with a stable `code`. */
export class AnimaeError extends Error {
  readonly code: string;
  readonly details?: unknown;
  readonly messageKey?: string;
  readonly params?: Record<string, JsonValue>;
  readonly messageNamespace?: string;
  constructor(code: string, message: string, details?: unknown, presentation?: AnimaeErrorPresentation) {
    super(message);
    this.name = "AnimaeError";
    this.code = code;
    this.details = details;
    if (presentation) {
      if (presentation.messageKey) this.messageKey = presentation.messageKey;
      if (presentation.params) this.params = presentation.params;
      if (presentation.namespace) this.messageNamespace = presentation.namespace;
    }
  }

  /** Localize using an Animae i18n instance (`t` accepts `namespace:key` or bare keys). */
  localizedMessage(t: (key: string, params?: Record<string, JsonValue>) => string): string {
    if (this.messageKey) {
      const key = this.messageNamespace ? `${this.messageNamespace}:${this.messageKey}` : this.messageKey;
      return t(key, this.params);
    }
    return this.message;
  }
}

export type Usage = { inputTokens: number; outputTokens: number; cachedInputTokens?: number };

/** Reference to anything that has a `then`-less shape for CEL contexts. */
export type CelContext = Record<string, unknown>;
