import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "bun:test";
import { runInit } from "../src/commands/init.ts";
import { runValidate } from "../src/commands/validate.ts";
import { runCli } from "../src/cli.ts";

test("init refuses overwrite and validate passes on fresh skeleton", async () => {
  const dir = await mkdtemp(join(tmpdir(), "animae-cli-"));
  try {
    expect(await runInit({ dir })).toBe(0);
    expect(await runInit({ dir })).toBe(1);
    expect(await runValidate(dir)).toBe(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("init --preset writes quoted npm preset id for YAML", async () => {
  const dir = await mkdtemp(join(tmpdir(), "animae-cli-preset-"));
  try {
    expect(await runInit({ dir, preset: "@animae/preset-base" })).toBe(0);
    expect(await runValidate(dir)).toBe(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runCli validate exit code", async () => {
  const dir = await mkdtemp(join(tmpdir(), "animae-cli-v-"));
  try {
    await runInit({ dir });
    const code = await runCli(["--root", dir, "validate"], {});
    expect(code).toBe(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
