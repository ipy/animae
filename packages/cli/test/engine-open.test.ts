import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { runInit } from "../src/commands/init.ts";
import { openEngine, validateDataRoot } from "../src/engine-open.ts";

test("validateDataRoot ok on init skeleton", async () => {
  const dir = await mkdtemp(join(tmpdir(), "animae-open-"));
  try {
    await runInit({ dir, preset: "@animae/preset-rule" });
    const r = await validateDataRoot(dir);
    expect(r.ok).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("openEngine rule mode reports rule backends", async () => {
  const dir = await mkdtemp(join(tmpdir(), "animae-open-mode-"));
  try {
    await runInit({ dir, preset: "@animae/preset-rule" });
    const engine = await openEngine({ root: dir, mode: "rule" });
    expect(engine.info().models.s1).toBe("rule");
    await engine.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
