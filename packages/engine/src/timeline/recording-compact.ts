import { randomBytes } from "node:crypto";
import { open, readFile, rename } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { StoragePort } from "../ports.ts";
import { parseJsonlLines } from "../store/util.ts";
import {
  isStreamPartsResponse,
  normalizeStreamResponseForStorage,
  recordingResponseEqual,
} from "../model/recording-stream.ts";

export { recordingResponseEqual } from "../model/recording-stream.ts";
import { assertRelativePath } from "../store/path.ts";

export const RECORDINGS_COMPACT_MIN_BYTES = 64 * 1024;

export interface RecordingLine {
  key: string;
  response: unknown;
  v?: number;
}

export interface CompactRecordingsStats {
  before: number;
  after: number;
  droppedDuplicates: number;
  droppedPartials: number;
  compacted: boolean;
}

export function compactRecordingLines(lines: RecordingLine[]): { lines: RecordingLine[]; stats: Omit<CompactRecordingsStats, "before" | "after" | "compacted"> } {
  const order: string[] = [];
  const byKey = new Map<string, RecordingLine>();
  let droppedDuplicates = 0;
  let droppedPartials = 0;

  for (const line of lines) {
    const { response, droppedPartials: dp } = normalizeStreamResponseForStorage(line.response);
    droppedPartials += dp;
    const normalized: RecordingLine = {
      key: line.key,
      response,
      ...(isStreamPartsResponse(response) ? { v: 2 } : line.v !== undefined ? { v: line.v } : {}),
    };
    if (byKey.has(line.key)) {
      droppedDuplicates += 1;
      const idx = order.indexOf(line.key);
      if (idx >= 0) order.splice(idx, 1);
    }
    order.push(line.key);
    byKey.set(line.key, normalized);
  }

  return {
    lines: order.map((k) => byKey.get(k)!),
    stats: { droppedDuplicates, droppedPartials },
  };
}

export function compactRecordingsText(text: string): { text: string; stats: CompactRecordingsStats } {
  const before = Buffer.byteLength(text, "utf8");
  if (!text.trim()) {
    return { text: "", stats: { before, after: 0, droppedDuplicates: 0, droppedPartials: 0, compacted: false } };
  }
  const parsed = parseJsonlLines(text) as RecordingLine[];
  const { lines, stats } = compactRecordingLines(parsed);
  const body = lines.map((l) => JSON.stringify(l)).join("\n");
  const out = body ? `${body}\n` : "";
  const after = Buffer.byteLength(out, "utf8");
  return {
    text: out,
    stats: { before, after, ...stats, compacted: after < before },
  };
}

export function shouldRewriteCompacted(stats: CompactRecordingsStats): boolean {
  if (stats.after >= stats.before) return false;
  if (stats.before <= RECORDINGS_COMPACT_MIN_BYTES && stats.droppedDuplicates === 0 && stats.droppedPartials === 0) {
    return false;
  }
  return stats.droppedDuplicates > 0 || stats.droppedPartials > 0 || stats.before > RECORDINGS_COMPACT_MIN_BYTES;
}

async function writeAtomicAbsolute(target: string, data: string): Promise<void> {
  const dir = dirname(target);
  const tmp = resolve(dir, `.${target.split("/").pop()}.tmp-${randomBytes(4).toString("hex")}`);
  const fh = await open(tmp, "w");
  try {
    await fh.writeFile(data, "utf8");
    await fh.sync();
  } finally {
    await fh.close();
  }
  await rename(tmp, target);
}

/**
 * Compact a recordings.jsonl file on disk (tools/tests).
 *
 * The rewrite is atomic (temp file + rename) but it is a read-modify-write: only run it while no engine has the root
 * open, because a line appended in between would be lost. The engine itself compacts through
 * `compactRecordingsStorage` while it holds the storage lock.
 */
export async function compactRecordingsFile(path: string): Promise<CompactRecordingsStats> {
  const abs = resolve(path);
  let text: string;
  try {
    text = await readFile(abs, "utf8");
  } catch {
    return { before: 0, after: 0, droppedDuplicates: 0, droppedPartials: 0, compacted: false };
  }
  const { text: compacted, stats } = compactRecordingsText(text);
  if (shouldRewriteCompacted(stats)) {
    await writeAtomicAbsolute(abs, compacted);
  }
  return stats;
}

export async function compactRecordingsStorage(
  storage: StoragePort,
  relPath: string,
): Promise<CompactRecordingsStats> {
  try {
    const path = assertRelativePath(relPath);
    const text = (await storage.readText(path)) ?? "";
    const { text: compacted, stats } = compactRecordingsText(text);
    if (shouldRewriteCompacted(stats)) {
      await storage.writeAtomic(path, compacted);
    }
    return stats;
  } catch {
    return { before: 0, after: 0, droppedDuplicates: 0, droppedPartials: 0, compacted: false };
  }
}

/** True when an append would not change lookup (last-wins) result. */
export function recordingAppendWouldBeDuplicate(lines: RecordingLine[], key: string, response: unknown): boolean {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i]!.key === key) return recordingResponseEqual(lines[i]!.response, response);
  }
  return false;
}

export function recordingLineForAppend(key: string, response: unknown): RecordingLine {
  const { response: normalized } = normalizeStreamResponseForStorage(response);
  return {
    key,
    response: normalized,
    ...(isStreamPartsResponse(normalized) ? { v: 2 } : {}),
  };
}
