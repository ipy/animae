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

/** Reads the sidecar's stdout one line at a time, so a test can answer before it closes stdin. */
function lineReader(stream: ReadableStream<Uint8Array>): () => Promise<string | undefined> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  return async () => {
    for (;;) {
      const nl = buffer.indexOf("\n");
      if (nl >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        return line;
      }
      const { done, value } = await reader.read();
      if (done) {
        const rest = buffer;
        buffer = "";
        return rest || undefined;
      }
      buffer += decoder.decode(value, { stream: true });
    }
  };
}

type RpcMessage = { id?: number; method?: string; result?: any; error?: unknown; params?: any };

test("bin.ts serve --stdio answers each request as it arrives and plays on the rule backend without models", async () => {
  const dir = await mkdtemp(join(tmpdir(), "animae-serve-session-"));
  const bin = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "bin.ts");
  try {
    await runInit({ dir });
    const proc = Bun.spawn(["bun", bin, "--root", dir, "serve", "--stdio"], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    const nextLine = lineReader(proc.stdout);
    const request = (id: number, method: string, params: unknown = {}): string =>
      `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`;
    const notifications: RpcMessage[] = [];
    /** The response to `id`; notifications that arrive first are kept apart. */
    const response = async (id: number): Promise<RpcMessage> => {
      for (;;) {
        const line = await nextLine();
        if (line === undefined) throw new Error(`the sidecar closed its output before it answered request ${id}`);
        const message = JSON.parse(line) as RpcMessage;
        if (message.id === id) return message;
        notifications.push(message);
      }
    };

    // One request at a time, stdin stays open: every answer has to arrive before the next request is sent.
    proc.stdin.write(request(1, "info"));
    const info = await response(1);
    expect(info.result.models).toMatchObject({ s1: "rule", s2: "rule", s1Llm: false });
    expect(info.result.mode).toEqual({ appraise: "rule", render: "rule" });

    proc.stdin.write(request(2, "scene.start", { location: "home", participants: ["player"] }));
    const sceneId = (await response(2)).result as string;
    expect(typeof sceneId).toBe("string");

    proc.stdin.write(request(3, "scene.turn", { sceneId, actor: "player", text: "hello there" }));
    const turn = await response(3);
    expect(turn.error).toBeUndefined();
    const chunks = (turn.result.chunks as { type: string }[]).map((c) => c.type);
    expect(chunks).toContain("text");
    expect(chunks.at(-1)).toBe("done");
    // the same chunks were streamed as notifications while the turn ran
    expect(notifications.filter((m) => m.method === "turn.chunk").length).toBe(chunks.length);

    // Several requests in one write: each one still gets its own answer.
    proc.stdin.write(request(4, "runtime.mode") + request(5, "world.now"));
    const [mode, now] = [await response(4), await response(5)];
    expect(mode.result.mode).toEqual({ appraise: "rule", render: "rule" });
    expect(now.error).toBeUndefined();

    proc.stdin.end();
    expect(await proc.exited).toBe(0);
    expect(await new Response(proc.stderr).text()).toBe("");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 30_000);
