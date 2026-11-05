import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { expect, test } from "bun:test";
import { runInit } from "../src/commands/init.ts";
import { runRunCommand } from "../src/commands/run-cmd.ts";
import { withCapturedStdout } from "./helpers/io.ts";

test("run --plain scripted session and colon quit", async () => {
  const dir = await mkdtemp(join(tmpdir(), "animae-run-plain-"));
  const input = Readable.from([":help\n", ":quit\n"]);
  const origStdin = process.stdin;
  Object.defineProperty(process, "stdin", { value: input, configurable: true });
  try {
    await runInit({ dir, preset: "@animae/preset-rule" });
    const { code, out } = await withCapturedStdout(() =>
      runRunCommand({ root: dir, mode: "rule", plain: true, scene: "home" }),
    );
    expect(code).toBe(0);
    expect(out).toContain(":save");
  } finally {
    Object.defineProperty(process, "stdin", { value: origStdin, configurable: true });
    await rm(dir, { recursive: true, force: true });
  }
});
