import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { runInit } from "../src/commands/init.ts";
import { runValidate } from "../src/commands/validate.ts";
import { withCapturedStdout } from "./helpers/io.ts";

test("validate --mode rule reports readable issues for broken content", async () => {
  const dir = await mkdtemp(join(tmpdir(), "animae-validate-fail-"));
  try {
    await runInit({ dir, preset: "@animae/preset-rule" });
    await writeFile(join(dir, "characters/player/card.md"), "not valid frontmatter\n");
    const { code, out } = await withCapturedStdout(() => runValidate(dir, undefined, undefined, "rule"));
    expect(code).toBe(1);
    expect(out).toMatch(/card\.md|CONFIG|invalid/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
