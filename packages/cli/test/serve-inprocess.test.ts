import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, expect, test } from "bun:test";
import { runInit } from "../src/commands/init.ts";
import { runServe } from "../src/commands/serve.ts";
import { withCapturedStdout } from "./helpers/io.ts";

let dir = "";

afterEach(async () => {
  if (dir) {
    await rm(dir, { recursive: true, force: true });
    dir = "";
  }
});

test("runServe --stdio runs JSON-RPC until stdin closes", async () => {
  dir = await mkdtemp(join(tmpdir(), "animae-serve-inproc-run-"));
  await runInit({ dir, preset: "@animae/preset-rule" });

  const line = `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "info" })}\n`;
  const input = Readable.from([line]);
  const origIn = process.stdin;
  Object.defineProperty(process, "stdin", { value: input, configurable: true });
  try {
    const { code, out } = await withCapturedStdout(() =>
      runServe({ root: dir, mode: "rule", stdio: true }),
    );
    expect(code).toBe(0);
    expect(out).toContain('"branch"');
    const parsed = JSON.parse(out.trim().split("\n").find((l) => l.includes('"result"'))!) as {
      result?: { branch?: string };
    };
    expect(parsed.result?.branch).toBeDefined();
  } finally {
    Object.defineProperty(process, "stdin", { value: origIn, configurable: true });
  }
});

test("runServe wires imageCommand port when opening engine", async () => {
  dir = await mkdtemp(join(tmpdir(), "animae-serve-img-"));
  await runInit({ dir, preset: "@animae/preset-rule" });
  const script = join(dir, "img.sh");
  await writeFile(
    script,
    `#!/bin/sh
cat >/dev/null
printf '\\x89PNG\\r\\n\\x1a\\n\\0\\0\\0\\0\\0\\0\\0\\0\\0\\0\\0\\0\\0\\0\\0\\0\\0\\0\\0\\0'
`,
  );
  await chmod(script, 0o755);

  const line = `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "info" })}\n`;
  const input = Readable.from([line]);
  const origIn = process.stdin;
  Object.defineProperty(process, "stdin", { value: input, configurable: true });
  try {
    const { code, out } = await withCapturedStdout(() =>
      runServe({ root: dir, mode: "rule", stdio: true, imageCommand: script, imageCommandArgs: ["--x"] }),
    );
    expect(code).toBe(0);
    expect(out).toContain('"branch"');
  } finally {
    Object.defineProperty(process, "stdin", { value: origIn, configurable: true });
  }
});
