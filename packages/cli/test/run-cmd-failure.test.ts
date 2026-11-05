import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { runRunCommand } from "../src/commands/run-cmd.ts";
import { withCapturedStdout } from "./helpers/io.ts";

test("runRunCommand fails when data root is missing", async () => {
  const missing = await mkdtemp(join(tmpdir(), "animae-run-miss-"));
  await rm(missing, { recursive: true, force: true });
  const { code, err } = await withCapturedStdout(() =>
    runRunCommand({ root: missing, mode: "rule", plain: true, scene: "home" }),
  );
  expect(code).toBe(1);
  expect(err.length).toBeGreaterThan(0);
});
