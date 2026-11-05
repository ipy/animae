import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { AnimaeError } from "@animae/engine";
import { formatCliError, printError } from "../src/errors.ts";
import { readPackageVersion } from "../src/version.ts";
import { runInit } from "../src/commands/init.ts";
import { runTimeline } from "../src/commands/timeline.ts";
import { runInspect } from "../src/commands/inspect.ts";
import { runColonCommand } from "../src/plain/colon-commands.ts";
import { openEngine } from "../src/engine-open.ts";

let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "animae-cli-smoke-"));
  await runInit({ dir, preset: "@animae/preset-rule" });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("formatCliError MODEL_CONFIG and CONFIG_INVALID branches", () => {
  expect(formatCliError(new AnimaeError("MODEL_CONFIG", "missing"))).toContain("Hint:");
  expect(
    formatCliError(
      new AnimaeError("CONFIG_INVALID", "bad", {
        issues: [{ file: "a.yaml", path: "x", message: "nope" }],
      }),
    ),
  ).toContain("a.yaml:x:");
});

test("printError writes to stderr", () => {
  const lines: string[] = [];
  printError(new Error("boom"), { write: (s: string) => (lines.push(s), true) } as NodeJS.WritableStream);
  expect(lines.join("")).toContain("boom");
});

test("readPackageVersion returns semver string", () => {
  expect(readPackageVersion()).toMatch(/^\d+\.\d+\.\d+/);
});

test("timeline list on fresh init project", async () => {
  const out: string[] = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((s: string | Uint8Array) => (out.push(String(s)), true)) as typeof process.stdout.write;
  try {
    expect(await runTimeline("list", [], { root: dir, mode: "rule" })).toBe(0);
    expect(out.join("")).toContain("branch:");
  } finally {
    process.stdout.write = orig;
  }
});

test("inspect missing engine root fails gracefully", async () => {
  const err: string[] = [];
  const orig = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((s: string | Uint8Array) => (err.push(String(s)), true)) as typeof process.stderr.write;
  try {
    expect(await runInspect({ root: join(dir, "missing"), path: "scene" })).toBe(1);
    expect(err.join("")).not.toBe("");
  } finally {
    process.stderr.write = orig;
  }
});

test("colon query command uses engine query path", async () => {
  const engine = await openEngine({ root: dir, mode: "rule" });
  try {
    const lines: string[] = [];
    await runColonCommand(":query debug world/location", {
      engine,
      viewer: "player",
      notify: (msg) => lines.push(msg),
    });
    expect(lines.some((l) => l.includes("home") || l.includes("null"))).toBe(true);
  } finally {
    await engine.close();
  }
});
