import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { spawnCli } from "./cli-process.ts";
import { freshRuleRoot, rootArgs } from "./e2e-shared.ts";

const TURN_SCRIPT = "determinism line\n:quit\n";

async function eventsLogAfterPlainRun(seed: number): Promise<string> {
  const { dir, cleanup } = await freshRuleRoot();
  try {
    const r = await spawnCli({
      args: ["--root", dir, "--mode", "rule", "--seed", String(seed), "run", "--plain", "--scene", "home"],
      stdin: TURN_SCRIPT,
      timeoutMs: 14_000,
    });
    expect(r.exitCode).toBe(0);
    return await readFile(join(dir, "timelines/main/events.jsonl"), "utf8");
  } finally {
    await cleanup();
  }
}

/**
 * Keys allowed to differ between runs (wall-clock / session identity metadata).
 * See docs/embedding.md determinism checklist (`sessionId` / per-event `sid`).
 */
const NON_DETERMINISTIC_JSON_KEYS = new Set<string>(["createdAt", "sid"]);

function collectDiffPaths(a: unknown, b: unknown, prefix = ""): Set<string> {
  const paths = new Set<string>();
  if (typeof a !== typeof b) {
    paths.add(prefix || "(root)");
    return paths;
  }
  if (a === null || b === null || typeof a !== "object") {
    if (a !== b) paths.add(prefix || "(root)");
    return paths;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) paths.add(`${prefix}.length`);
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
      for (const p of collectDiffPaths(a[i], b[i], `${prefix}[${i}]`)) paths.add(p);
    }
    return paths;
  }
  const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
  for (const k of keys) {
    const p = prefix ? `${prefix}.${k}` : k;
    for (const d of collectDiffPaths((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], p)) {
      paths.add(d);
    }
  }
  return paths;
}

function parseEventsJsonl(raw: string): unknown[] {
  return raw
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as unknown);
}

test("same seed and inputs yield identical events.jsonl across two processes (I6)", async () => {
  const seed = 77;
  const [logA, logB] = await Promise.all([eventsLogAfterPlainRun(seed), eventsLogAfterPlainRun(seed)]);

  if (logA === logB) return;

  const eventsA = parseEventsJsonl(logA);
  const eventsB = parseEventsJsonl(logB);
  expect(eventsA.length).toBe(eventsB.length);

  const differing = new Set<string>();
  for (let i = 0; i < eventsA.length; i++) {
    for (const p of collectDiffPaths(eventsA[i], eventsB[i], `[${i}]`)) differing.add(p);
  }

  const unexpected = [...differing].filter((p) => {
    const leaf = p.split(".").pop()?.replace(/\[\d+\]$/, "") ?? p;
    return !NON_DETERMINISTIC_JSON_KEYS.has(leaf);
  });
  expect(unexpected).toEqual([]);
}, 15_000);
