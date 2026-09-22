import type { ZodType } from "zod";
import { z } from "zod";
import type { ModelPort, ModelRequestBase, StreamPart, ToolDef } from "../ports.ts";
import type { Usage } from "../types.ts";

export type ModelCallSlot = "s1" | "s2";

export type ModelCallLogStatus = "ok" | "error" | "aborted";

export interface ModelCallLogSegment {
  role: "static" | "semiStatic" | "dynamic" | "history" | "user";
  text: string;
  truncated?: boolean;
}

export interface ModelCallLogToolCall {
  name: string;
  input: unknown;
  output: unknown;
}

export interface ModelCallLogEntry {
  seq: number;
  id: string;
  startedAt: number;
  slot: ModelCallSlot;
  label: string;
  modelId: string;
  request: {
    segments: ModelCallLogSegment[];
    schema?: unknown;
    schemaName?: string;
    tools?: string[];
    params: {
      maxOutputTokens: number;
      maxSteps?: number;
      temperature?: number;
      seed?: number;
      recordingLocales?: ModelRequestBase["recordingLocales"];
    };
  };
  response?: {
    raw: string;
    final?: unknown;
    toolCalls?: ModelCallLogToolCall[];
    usage?: Usage;
    finishReason?: string;
    truncated?: boolean;
  };
  timing: { firstChunkMs?: number; totalMs: number };
  error?: { code?: string; message: string };
  turnId?: string;
  requestId?: string;
  status: ModelCallLogStatus;
}

export interface ModelCallLogOptions {
  capacity?: number;
  maxCharsPerEntry?: number;
}

export interface ModelCallLogQuery {
  since?: number;
  limit?: number;
  label?: string;
  slot?: ModelCallSlot;
  errorsOnly?: boolean;
}

export interface ModelCallLog {
  readonly capacity: number;
  list(query?: ModelCallLogQuery): ModelCallLogEntry[];
  get(seq: number): ModelCallLogEntry | undefined;
  clear(): void;
  toJsonl(): string;
}

const DEFAULT_CAPACITY = 200;
const DEFAULT_MAX_CHARS = 48_000;

const REDACT_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{8,}\b/g,
  /\bBearer\s+[A-Za-z0-9._-]{8,}\b/gi,
  /\bx-api-key:\s*\S+/gi,
  /\bauthorization:\s*\S+/gi,
];

export function redactSecrets(text: string): string {
  let out = text;
  for (const re of REDACT_PATTERNS) {
    out = out.replace(re, "[REDACTED]");
  }
  return out;
}

function truncateText(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  return { text: `${text.slice(0, max)}\n… [truncated ${text.length - max} chars]`, truncated: true };
}

function schemaForLog(schema: ZodType<unknown>): { schema?: unknown; schemaName?: string } {
  try {
    return { schema: z.toJSONSchema(schema), schemaName: schema.description ?? undefined };
  } catch {
    return { schemaName: schema.description ?? "schema" };
  }
}

function segmentsForLog(segments: ModelRequestBase["segments"], maxChars: number): ModelCallLogSegment[] {
  const out: ModelCallLogSegment[] = [];
  const push = (role: ModelCallLogSegment["role"], raw: string) => {
    const cleaned = redactSecrets(raw);
    const { text, truncated } = truncateText(cleaned, Math.floor(maxChars / 6));
    out.push({ role, text, ...(truncated ? { truncated: true } : {}) });
  };
  push("static", segments.static);
  push("semiStatic", segments.semiStatic);
  push("dynamic", segments.dynamic);
  if (segments.history?.length) {
    const hist = segments.history
      .map((h) => `${h.role}: ${h.content}`)
      .join("\n");
    push("history", hist);
  }
  push("user", segments.user);
  return out;
}

function isAbortError(err: unknown): boolean {
  if (err instanceof Error && err.name === "AbortError") return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /abort/i.test(msg);
}

let entryCounter = 0;

export function createModelCallLog(opts: ModelCallLogOptions = {}): ModelCallLog {
  const capacity = opts.capacity ?? DEFAULT_CAPACITY;
  const maxCharsPerEntry = opts.maxCharsPerEntry ?? DEFAULT_MAX_CHARS;
  const buffer: ModelCallLogEntry[] = [];
  let seq = 0;

  const append = (entry: ModelCallLogEntry) => {
    buffer.push(entry);
    while (buffer.length > capacity) buffer.shift();
  };

  const api: ModelCallLog = {
    capacity,
    list(query = {}) {
      let rows = [...buffer];
      if (query.since != null) rows = rows.filter((e) => e.seq > query.since!);
      if (query.label) rows = rows.filter((e) => e.label === query.label);
      if (query.slot) rows = rows.filter((e) => e.slot === query.slot);
      if (query.errorsOnly) rows = rows.filter((e) => e.status !== "ok");
      rows.sort((a, b) => b.seq - a.seq);
      const limit = query.limit ?? rows.length;
      return rows.slice(0, limit);
    },
    get(seqNum: number) {
      return buffer.find((e) => e.seq === seqNum);
    },
    clear() {
      buffer.length = 0;
    },
    toJsonl() {
      return buffer.map((e) => JSON.stringify(e)).join("\n");
    },
  };

  const internal = {
    api,
    append,
    nextSeq: () => {
      seq += 1;
      return seq;
    },
    maxChars: maxCharsPerEntry,
  };

  modelCallLogRegistry.set(api, internal);
  return api;
}

const modelCallLogRegistry = new WeakMap<
  ModelCallLog,
  { append: (e: ModelCallLogEntry) => void; nextSeq: () => number; maxChars: number }
>();

function logInternals(log: ModelCallLog) {
  const hit = modelCallLogRegistry.get(log);
  if (!hit) throw new Error("Invalid ModelCallLog instance");
  return hit;
}

function finalizeResponseRaw(value: unknown, maxChars: number): { raw: string; truncated?: boolean } {
  const full = typeof value === "string" ? value : JSON.stringify(value, null, 0);
  const cleaned = redactSecrets(full);
  const { text, truncated } = truncateText(cleaned, maxChars);
  return { raw: text, ...(truncated ? { truncated: true } : {}) };
}

export function withModelCallLog(
  port: ModelPort,
  ctx: { slot: ModelCallSlot; log: ModelCallLog; turnId?: () => string | undefined; requestId?: () => string | undefined },
): ModelPort {
  const internal = logInternals(ctx.log);

  const startEntry = (req: ModelRequestBase & { schema: ZodType<unknown> }): ModelCallLogEntry => {
    const schemaInfo = schemaForLog(req.schema);
    const seq = internal.nextSeq();
    entryCounter += 1;
    const startedAt = Date.now();
    return {
      seq,
      id: `mcl_${startedAt.toString(36)}_${entryCounter}`,
      startedAt,
      slot: ctx.slot,
      label: req.label,
      modelId: port.id,
      request: {
        segments: segmentsForLog(req.segments, internal.maxChars),
        ...schemaInfo,
        tools: (req.tools ?? []).map((t: ToolDef) => t.name),
        params: {
          maxOutputTokens: req.maxOutputTokens,
          maxSteps: req.maxSteps,
          temperature: req.temperature,
          seed: req.seed,
          recordingLocales: req.recordingLocales,
        },
      },
      timing: { totalMs: 0 },
      turnId: ctx.turnId?.(),
      requestId: ctx.requestId?.(),
      status: "ok",
    };
  };

  const wrapped: ModelPort = {
    id: port.id,
    usage: port.usage?.bind(port),
    async object<T>(req: ModelRequestBase & { schema: ZodType<T> }): Promise<T> {
      const entry = startEntry(req);
      const t0 = Date.now();
      try {
        const value = await port.object(req);
        entry.timing.totalMs = Date.now() - t0;
        entry.timing.firstChunkMs = entry.timing.totalMs;
        const { raw, truncated } = finalizeResponseRaw(value, internal.maxChars);
        entry.response = { raw, final: value, ...(truncated ? { truncated: true } : {}) };
        internal.append(entry);
        return value;
      } catch (err) {
        entry.timing.totalMs = Date.now() - t0;
        entry.status = isAbortError(err) ? "aborted" : "error";
        entry.error = {
          message: redactSecrets(err instanceof Error ? err.message : String(err)),
          ...(err instanceof Error && "code" in err ? { code: String((err as { code?: unknown }).code) } : {}),
        };
        internal.append(entry);
        throw err;
      }
    },
    stream(req: ModelRequestBase & { schema: ZodType<unknown> }) {
      const entry = startEntry(req);
      const t0 = Date.now();
      const toolCalls: ModelCallLogToolCall[] = [];
      let lastFinal: unknown;
      let usage: Usage | undefined;

      async function* wrap(): AsyncGenerator<StreamPart> {
        try {
          for await (const part of port.stream(req)) {
            if (entry.timing.firstChunkMs == null) entry.timing.firstChunkMs = Date.now() - t0;
            if (part.type === "tool") {
              toolCalls.push({ name: part.name, input: part.input, output: part.output });
            }
            if (part.type === "final") {
              lastFinal = part.value;
              usage = part.usage;
            }
            yield part;
          }
          entry.timing.totalMs = Date.now() - t0;
          const { raw, truncated } = finalizeResponseRaw(lastFinal ?? "", internal.maxChars);
          entry.response = {
            raw,
            final: lastFinal,
            toolCalls: toolCalls.length ? toolCalls : undefined,
            usage,
            ...(truncated ? { truncated: true } : {}),
          };
          internal.append(entry);
        } catch (err) {
          entry.timing.totalMs = Date.now() - t0;
          entry.status = isAbortError(err) ? "aborted" : "error";
          entry.error = {
            message: redactSecrets(err instanceof Error ? err.message : String(err)),
          };
          if (lastFinal !== undefined) {
            const { raw } = finalizeResponseRaw(lastFinal, internal.maxChars);
            entry.response = { raw, final: lastFinal, toolCalls: toolCalls.length ? toolCalls : undefined, usage };
          }
          internal.append(entry);
          throw err;
        }
      }
      return wrap();
    },
  };
  Object.defineProperty(wrapped, "tags", {
    get(): readonly string[] | undefined {
      return port.tags;
    },
    set(v: readonly string[] | undefined) {
      (port as { tags?: string[] }).tags = v ? [...v] : undefined;
    },
    enumerable: true,
    configurable: true,
  });
  return wrapped;
}

export async function writeModelCallLogJsonl(log: ModelCallLog, dir: string): Promise<string> {
  const { mkdir, writeFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = join(dir, "llm-log");
  await mkdir(outDir, { recursive: true });
  const file = join(outDir, `${stamp}.jsonl`);
  await writeFile(file, log.toJsonl(), "utf8");
  return file;
}
