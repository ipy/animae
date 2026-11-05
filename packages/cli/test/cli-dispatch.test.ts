import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { runCli } from "../src/cli.ts";
import { helpText } from "../src/args.ts";
import { withCapturedStdout } from "./helpers/io.ts";

test("runCli help and version", async () => {
  const help = await withCapturedStdout(() => runCli(["--help"], {}));
  expect(help.code).toBe(0);
  expect(help.out).toBe(helpText());

  const ver = await withCapturedStdout(() => runCli(["--version"], {}));
  expect(ver.code).toBe(0);
  expect(ver.out.trim()).toMatch(/^\d+\.\d+\.\d+/);
});

test("runCli missing init dir prints error and exits 1", async () => {
  const { code, err } = await withCapturedStdout(() => runCli(["init"], {}));
  expect(code).toBe(1);
  expect(err.length).toBeGreaterThan(0);
});

test("runCli validate and init on temp dir", async () => {
  const dir = await mkdtemp(join(tmpdir(), "animae-cli-dispatch-"));
  try {
    expect(await withCapturedStdout(() => runCli(["init", dir, "--preset", "@animae/preset-rule"], {})).then((r) => r.code)).toBe(0);
    expect(await withCapturedStdout(() => runCli(["--root", dir, "validate"], {})).then((r) => r.code)).toBe(0);
    expect(await withCapturedStdout(() => runCli(["--root", dir, "validate", "--mode", "rule"], {})).then((r) => r.code)).toBe(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runCli --lang affects help path via parseCli integration", async () => {
  const dir = await mkdtemp(join(tmpdir(), "animae-cli-lang-"));
  try {
    await runCli(["init", dir], {});
    const { code } = await withCapturedStdout(() => runCli(["--root", dir, "--lang", "en", "mods", "list"], {}));
    expect(code).toBe(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runCli rejects invalid --model-mode", async () => {
  const { code, err } = await withCapturedStdout(() => runCli(["--model-mode", "bogus", "help"], {}));
  expect(code).toBe(1);
  expect(err).toContain("Invalid --model-mode");
});
