import { createHash } from "node:crypto";
import YAML from "yaml";
import type { StoragePort } from "../ports.ts";
import { assertRelativePath } from "./path.ts";

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sortKeys);
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj).sort()) out[k] = sortKeys(obj[k]);
  return out;
}

export function parseYaml(text: string): unknown {
  return YAML.parse(text);
}

export function stringifyYaml(value: unknown): string {
  return YAML.stringify(value);
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export function parseFrontmatter(text: string): { data: Record<string, unknown>; body: string } {
  const m = text.match(FRONTMATTER_RE);
  if (!m) return { data: {}, body: text };
  const parsed = YAML.parse(m[1]!);
  return { data: (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>, body: m[2] ?? "" };
}

export async function readYamlFile<T = unknown>(storage: StoragePort, path: string): Promise<T | undefined> {
  const text = await storage.readText(assertRelativePath(path));
  if (text === undefined) return undefined;
  return parseYaml(text) as T;
}

/** Parse JSONL; blank lines skipped; a truncated final line is ignored. */
export function parseJsonlLines(text: string): unknown[] {
  const lines = text.split("\n");
  const out: unknown[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      if (i === lines.length - 1) break;
      throw new Error(`Invalid JSONL at line ${i + 1}`);
    }
  }
  return out;
}

export async function readJsonl<T = unknown>(storage: StoragePort, path: string): Promise<T[]> {
  const text = await storage.readText(assertRelativePath(path));
  if (text === undefined || text === "") return [];
  const { text: repaired } = repairJsonlText(text);
  return parseJsonlLines(repaired) as T[];
}

export async function appendJsonl(storage: StoragePort, path: string, obj: unknown, opts?: { fsync?: boolean }): Promise<void> {
  const line = `${JSON.stringify(obj)}\n`;
  await storage.append(assertRelativePath(path), line, opts);
}

/** Truncate file content to last complete JSONL lines (drops broken trailing line). */
export function repairJsonlText(text: string): { text: string; dropped: boolean } {
  if (!text) return { text: "", dropped: false };
  const lines = text.split("\n");
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  if (lines.length === 0) return { text: "", dropped: false };
  let dropped = false;
  while (lines.length) {
    const last = lines[lines.length - 1]!;
    try {
      JSON.parse(last);
      break;
    } catch {
      lines.pop();
      dropped = true;
    }
  }
  const repaired = lines.length ? `${lines.join("\n")}\n` : "";
  return { text: repaired, dropped };
}
