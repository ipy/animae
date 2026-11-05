import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Real CLI entry (same as production `bin.ts`). */
export const cliBinPath = join(dirname(fileURLToPath(import.meta.url)), "../../src/bin.ts");

const ENV_KEY_PREFIXES = [
  "ANTHROPIC_",
  "OPENAI_",
  "GOOGLE_",
  "GEMINI_",
  "OLLAMA_",
  "AI_GATEWAY_",
  "AZURE_OPENAI_",
  "AWS_",
  "VERTEX_",
  "COHERE_",
  "MISTRAL_",
  "XAI_",
  "DEEPSEEK_",
  "GROQ_",
  "TOGETHER_",
  "FIREWORKS_",
  "PERPLEXITY_",
  "HUGGINGFACE_",
  "REPLICATE_",
];

/** Drop provider API keys and related env so spawned CLI cannot reach the network. */
export function scrubNetworkEnv(base: Record<string, string | undefined> = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) {
    if (v === undefined) continue;
    if (ENV_KEY_PREFIXES.some((p) => k.startsWith(p))) continue;
    if (k === "HTTP_PROXY" || k === "HTTPS_PROXY" || k === "ALL_PROXY") continue;
    out[k] = v;
  }
  out.NODE_ENV = out.NODE_ENV ?? "test";
  return out;
}

export interface SpawnCliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  proc: Subprocess;
}

type Subprocess = ReturnType<typeof Bun.spawn>;
type PipeStream = ReadableStream<Uint8Array>;

function stdoutPipe(proc: Subprocess): PipeStream {
  const out = proc.stdout;
  if (!out || typeof out === "number") throw new Error("expected piped stdout");
  return out;
}

async function readPipe(stream: PipeStream | null | undefined): Promise<string> {
  if (!stream) return "";
  return new Response(stream).text();
}

export interface SpawnCliOptions {
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  stdin?: string | Buffer;
  timeoutMs?: number;
}

/**
 * Run the CLI as a child process with a hard timeout; kills the process in `finally` when still running.
 */
export async function spawnCli(opts: SpawnCliOptions): Promise<SpawnCliResult> {
  const timeoutMs = opts.timeoutMs ?? 14_000;
  const proc = Bun.spawn([process.execPath, cliBinPath, ...opts.args], {
    cwd: opts.cwd,
    env: opts.env ?? scrubNetworkEnv(),
    stdin: opts.stdin !== undefined ? "pipe" : "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (opts.stdin !== undefined && proc.stdin && typeof proc.stdin !== "number") {
    proc.stdin.write(opts.stdin);
    proc.stdin.end();
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`CLI timed out after ${timeoutMs}ms: ${opts.args.join(" ")}`));
    }, timeoutMs);
  });

  try {
    const [stdout, stderr, exitCode] = await Promise.race([
      Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]),
      timeout,
    ]);
    return { stdout, stderr, exitCode, proc };
  } finally {
    if (timer) clearTimeout(timer);
    if (proc.exitCode === null) proc.kill();
  }
}

/** Long-lived CLI (e.g. `serve --stdio`); caller must call {@link closeCliProcess}. */
export function spawnCliInteractive(args: string[], env?: Record<string, string>): Subprocess {
  return Bun.spawn([process.execPath, cliBinPath, ...args], {
    env: env ?? scrubNetworkEnv(),
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
}

export async function closeCliProcess(proc: Subprocess): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    if (proc.stdin && typeof proc.stdin !== "number") {
      try {
        proc.stdin.end();
      } catch {
        /* already closed */
      }
    }
  } finally {
    if (proc.exitCode === null) proc.kill();
  }
  const [stdout, stderr, exitCode] = await Promise.all([
    readPipe(typeof proc.stdout === "number" ? undefined : proc.stdout),
    readPipe(typeof proc.stderr === "number" ? undefined : proc.stderr),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

export function killCliProcess(proc: Subprocess): void {
  if (proc.exitCode === null) proc.kill();
}

/** Reads stdout one JSON-RPC line at a time. */
export function lineReader(stream: ReadableStream<Uint8Array>): () => Promise<string | undefined> {
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
        return rest.length ? rest : undefined;
      }
      buffer += decoder.decode(value, { stream: true });
    }
  };
}

export type RpcLine = {
  jsonrpc?: string;
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
};

export function rpcRequest(id: number, method: string, params: unknown = {}): string {
  return `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`;
}

export class StdioRpcClient {
  readonly notifications: RpcLine[] = [];
  private readonly nextLine: () => Promise<string | undefined>;
  private readonly proc: Subprocess;
  private id = 0;

  constructor(proc: Subprocess) {
    this.proc = proc;
    this.nextLine = lineReader(stdoutPipe(proc));
  }

  write(line: string): void {
    if (!this.proc.stdin || typeof this.proc.stdin === "number") throw new Error("stdin not available");
    this.proc.stdin.write(line);
  }

  request(method: string, params: unknown = {}): Promise<RpcLine> {
    const id = ++this.id;
    this.write(rpcRequest(id, method, params));
    return this.waitResponse(id);
  }

  async waitResponse(id: number): Promise<RpcLine> {
    for (;;) {
      const message = await this.readLine();
      if (message === undefined) throw new Error(`sidecar closed before answering request ${id}`);
      if (message.id === id) return message;
      this.notifications.push(message);
    }
  }

  async readLine(): Promise<RpcLine | undefined> {
    const line = await this.nextLine();
    if (line === undefined) return undefined;
    return JSON.parse(line) as RpcLine;
  }

  endStdin(): void {
    if (this.proc.stdin && typeof this.proc.stdin !== "number") this.proc.stdin.end();
  }

  async drainExit(timeoutMs = 14_000): Promise<number> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const raced = Promise.race([
      this.proc.exited,
      new Promise<number>((_, reject) => {
        timer = setTimeout(() => {
          this.proc.kill();
          reject(new Error("serve --stdio did not exit"));
        }, timeoutMs);
      }),
    ]);
    try {
      return await raced;
    } finally {
      if (timer) clearTimeout(timer);
      if (this.proc.exitCode === null) this.proc.kill();
    }
  }
}

/** Init skeleton + small mod overlay for mods explain/validate e2e. */
export async function writeDemoModOverlay(root: string): Promise<void> {
  const modRoot = join(root, "mods", "e2e-demo-mod");
  await mkdir(modRoot, { recursive: true });
  await writeFile(
    join(modRoot, "mod.yaml"),
    `id: e2e-demo-mod
name: E2E Demo
version: 1.0.0
`,
    "utf8",
  );
  await mkdir(join(modRoot, "world", "locations"), { recursive: true });
  await writeFile(
    join(modRoot, "world", "locations", "home.yaml"),
    `id: home
name: Modded Home
summary: Overlay from e2e mod.
tags: []
connects: []
vars: {}
`,
    "utf8",
  );
}
