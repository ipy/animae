import type { ZodType } from "zod";
import type { Usage } from "./types.ts";

/**
 * StoragePort — all paths are POSIX-style and RELATIVE to the data root (never start with "/" or contain "..").
 * The default implementation is `FsStorage` (store module): atomic writes (tmp + rename), appends with fsync.
 */
export interface StoragePort {
  readonly root: string;
  readText(path: string): Promise<string | undefined>;
  readBytes(path: string): Promise<Uint8Array | undefined>;
  /** write to `<path>.tmp-<rand>` then rename; creates parent dirs. */
  writeAtomic(path: string, data: string | Uint8Array): Promise<void>;
  /** append (creates file and parents if missing); fsync by default. */
  append(path: string, data: string, opts?: { fsync?: boolean }): Promise<void>;
  exists(path: string): Promise<boolean>;
  /** names (not paths) of direct children; [] if dir missing. Directories are suffixed with "/". */
  list(dir: string): Promise<string[]>;
  /** all FILE paths under dir (recursive, relative to root, sorted); [] if missing. */
  listFiles(dir: string): Promise<string[]>;
  mkdir(dir: string): Promise<void>;
  remove(path: string, opts?: { recursive?: boolean }): Promise<void>;
  stat(path: string): Promise<{ size: number; mtimeMs: number; isDir: boolean } | undefined>;
  /** Acquire the single-writer lock (`.animae.lock`, content = pid). Throws AnimaeError("LOCKED") if a live pid holds it. Stale locks are stolen. */
  acquireLock(): Promise<void>;
  releaseLock(): Promise<void>;
}

export interface EmbeddingPort {
  embed(texts: string[]): Promise<Float32Array[]>;
}

/** Prompt split into three cache-ordered segments plus chat history and the current user input. */
export interface PromptSegments {
  /** world rules, `always` knowledge, identity, constraints, style. Cache breakpoint 1 after this. */
  static: string;
  /** relation summary, long-term summaries, on-demand index. Updated once per scene. Cache breakpoint 2 after this. */
  semiStatic: string;
  /** tier labels, field effects, `when` knowledge, retrieval hits, sidenotes, task instructions. No cache. */
  dynamic: string;
  /** recent K turns of dialogue */
  history?: { role: "user" | "assistant"; content: string }[];
  /** the current input / task statement (final user message) */
  user: string;
}

export interface ToolDef {
  name: string;
  description: string;
  /** zod schema of the tool input */
  input: ZodType<unknown>;
  /** executed by the model adapter; results are RECORDED (record/replay) */
  execute(input: unknown): Promise<unknown> | unknown;
}

export interface ModelRequestBase {
  /** purpose label: "appraise" | "render" | "reflect" | "generate" | "narrate" | "offscreen" | ... (used in recording/log) */
  label: string;
  segments: PromptSegments;
  tools?: ToolDef[];
  maxOutputTokens: number;
  /** max tool-call steps (S2 default 3) */
  maxSteps?: number;
  temperature?: number;
  /** deterministic seed forwarded to providers that support it; part of the recording key */
  seed?: number;
  /** locale tags affecting prompt text; included in recording keys for determinism audits */
  recordingLocales?: { promptLocale: string; outputLocale: string; contentLocale: string };
}

export type StreamPart =
  /** a partial structured object so far (monotonically growing) */
  | { type: "partial"; value: unknown }
  | { type: "tool"; name: string; input: unknown; output: unknown }
  | { type: "final"; value: unknown; usage?: Usage };

export interface ModelPort {
  /** model identifier, e.g. "anthropic/claude-haiku-5-5" — part of the recording key */
  id: string;
  /** Host-defined capability tags (e.g. content tier labels) exposed to CEL as `model.tags`. */
  tags?: readonly string[];
  object<T>(req: ModelRequestBase & { schema: ZodType<T> }): Promise<T>;
  stream(req: ModelRequestBase & { schema: ZodType<unknown> }): AsyncIterable<StreamPart>;
  /** cumulative usage since creation (best effort) */
  usage?(): Usage;
}

export type ModelMode = "live" | "record" | "replay";
