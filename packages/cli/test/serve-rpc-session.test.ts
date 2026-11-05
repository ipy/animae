import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { test, expect } from "bun:test";
import { runInit } from "../src/commands/init.ts";
import { openEngine } from "../src/engine-open.ts";
import { createStdioRpcSession } from "../src/commands/serve.ts";

test("createStdioRpcSession handles sequential JSON-RPC requests", async () => {
  const dir = await mkdtemp(join(tmpdir(), "animae-serve-inproc-"));
  try {
    await runInit({ dir });
    const engine = await openEngine({ root: dir, mode: "rule" });
    const input = new PassThrough();
    const output = new PassThrough();
    const lines: string[] = [];
    output.on("data", (c) => lines.push(String(c)));

    const session = createStdioRpcSession(engine, input, output);
    const run = session.run();

    input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "mods" })}\n`);
    input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "setUiLocale", params: { locale: "en" } })}\n`);
    input.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "entities.setAlias",
        params: { input: { entity: "player", nickname: "P", by: "player" } },
      })}\n`,
    );
    input.end();

    await run;
    const parsed = lines.join("").trim().split("\n").map((l) => JSON.parse(l) as { id?: number; result?: unknown; error?: unknown });
    expect(parsed.find((m) => m.id === 1)?.error).toBeUndefined();
    expect(parsed.find((m) => m.id === 2)?.result).toBeNull();
    expect(parsed.find((m) => m.id === 3)?.error).toBeUndefined();
    await engine.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
