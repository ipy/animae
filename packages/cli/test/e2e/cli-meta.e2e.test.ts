import { expect, test } from "bun:test";
import { helpText } from "../../src/args.ts";
import { spawnCli } from "./cli-process.ts";
import { freshRuleRoot } from "./e2e-shared.ts";

test("help and version exit 0 with English output", async () => {
  const help = await spawnCli({ args: ["--help"] });
  expect(help.exitCode).toBe(0);
  expect(help.stdout).toBe(helpText());
  expect(help.stderr).toBe("");

  const ver = await spawnCli({ args: ["--version"] });
  expect(ver.exitCode).toBe(0);
  expect(ver.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  expect(ver.stderr).toBe("");
});

test("unknown top-level token falls back to help (exit 0)", async () => {
  const r = await spawnCli({ args: ["not-a-command"] });
  expect(r.exitCode).toBe(0);
  expect(r.stdout).toContain("animae — Animae engine CLI");
});

test("invalid global flag and missing required args exit 1 with English errors", async () => {
  const badMode = await spawnCli({ args: ["--mode", "bogus", "help"] });
  expect(badMode.exitCode).toBe(1);
  expect(badMode.stderr).toContain("Invalid --mode");

  const noDir = await spawnCli({ args: ["init"] });
  expect(noDir.exitCode).toBe(1);
  expect(noDir.stderr).toContain("init requires");

  const noPath = await spawnCli({ args: ["inspect"] });
  expect(noPath.exitCode).toBe(1);
  expect(noPath.stderr).toContain("inspect requires");
});

test("serve without --stdio is rejected", async () => {
  const r = await spawnCli({ args: ["serve"] });
  expect(r.exitCode).toBe(1);
  expect(r.stderr).toMatch(/stdio/);
});

test("unknown timeline subcommand exits 1 with English message", async () => {
  const { dir, cleanup } = await freshRuleRoot();
  try {
    const r = await spawnCli({ args: ["--root", dir, "timeline", "not-a-sub"], timeoutMs: 10_000 });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("Unknown timeline subcommand");
  } finally {
    await cleanup();
  }
});
