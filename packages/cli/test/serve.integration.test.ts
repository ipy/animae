import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "bun:test";
import { runInit } from "../src/commands/init.ts";

test("bin.ts serve --stdio JSON-RPC smoke", async () => {
  const dir = await mkdtemp(join(tmpdir(), "animae-serve-spawn-"));
  const bin = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "bin.ts");
  try {
    await runInit({ dir });
    const cfg = await readFile(join(dir, "animae.yaml"), "utf8");
    await writeFile(
      join(dir, "animae.yaml"),
      `${cfg}models:
  s1: { provider: anthropic, model: claude-haiku-4-5 }
  s2: { provider: anthropic, model: claude-haiku-4-5 }
`,
    );
    const proc = Bun.spawn(["bun", bin, "--root", dir, "serve", "--stdio"], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, ANTHROPIC_API_KEY: "test-key" },
    });
    await new Promise((r) => setTimeout(r, 200));
    proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "info" })}\n`);
    proc.stdin.end();
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain('"branch":"main"');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 15_000);
