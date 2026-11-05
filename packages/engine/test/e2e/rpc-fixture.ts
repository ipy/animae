import { z } from "zod";
import { createRpcServer } from "../../src/rpc/index.ts";
import type { Engine } from "../../src/api.ts";
import type { TurnChunk } from "../../src/types.ts";
import { memoryDuplex } from "../rpc/duplex.ts";
import { openRuleEngine, rulePreset, type RuleEngineHandle } from "../helpers/rule-fixture.ts";
import { scriptedLlm } from "../helpers/llm-scripts.ts";

export type RpcMsg = {
  id?: number | string | null;
  method?: string;
  result?: unknown;
  error?: { code: number; message: string; data?: { code?: string; details?: unknown } };
  params?: { requestId?: number; chunk?: TurnChunk };
};

export const InfoResultSchema = z.object({
  branch: z.string(),
  sessionId: z.string(),
  language: z.string(),
  locale: z.string(),
  mode: z.unknown(),
  modelMode: z.string(),
  models: z.unknown(),
});

export const SceneTurnResultSchema = z.object({
  events: z.array(z.string()),
  chunks: z.array(z.unknown()),
  summary: z.object({ turnId: z.string() }).optional(),
});

export const SceneReportSchema = z.object({
  sceneId: z.string(),
  turns: z.number(),
  events: z.number(),
});

export const ModsResultSchema = z.object({
  mods: z.array(z.unknown()),
  drift: z.boolean(),
  provenance: z.unknown(),
});

export const ExplainResultSchema = z.object({
  turnId: z.string(),
  chain: z.array(z.object({ kind: z.string(), data: z.unknown().optional() })),
});

/** Line-delimited JSON-RPC session over PassThrough-style memory duplex. */
export function createRpcLineSession(engine: Engine) {
  const io = memoryDuplex();
  const server = createRpcServer(engine, io);
  const run = server.run();
  let nextId = 1;

  const messages = (): RpcMsg[] => io.written.map((l) => JSON.parse(l) as RpcMsg);

  const sendRaw = (line: string): void => {
    io.push(line);
  };

  const send = (method: string, params?: unknown): number => {
    const id = nextId++;
    io.push(JSON.stringify({ jsonrpc: "2.0", id, method, params: params ?? {} }));
    return id;
  };

  const response = async (id: number, deadlineMs = 30_000): Promise<RpcMsg> => {
    const start = Date.now();
    while (Date.now() - start < deadlineMs) {
      const m = messages().find((x) => x.id === id);
      if (m) return m;
      await new Promise((r) => setTimeout(r, 2));
    }
    throw new Error(`no JSON-RPC response for id ${id}`);
  };

  return {
    sendRaw,
    send,
    response,
    messages,
    chunksFor(requestId: number): TurnChunk[] {
      return messages()
        .filter((m) => m.method === "turn.chunk" && m.params?.requestId === requestId)
        .map((m) => m.params!.chunk!);
    },
    call: async (method: string, params?: unknown) => response(send(method, params)),
    async close(): Promise<void> {
      io.close();
      await run;
    },
  };
}

export async function openRpcRuleEngine(
  opts: Parameters<typeof openRuleEngine>[0] = {},
): Promise<RuleEngineHandle & { llm: ReturnType<typeof scriptedLlm> }> {
  const llm = scriptedLlm();
  const h = await openRuleEngine({
    mode: "rule",
    preset: rulePreset(),
    ...opts,
    models: opts.models ?? { s1: llm.s1, s2: llm.s2 },
  });
  return { ...h, llm };
}

export { rulePreset, scriptedLlm, memoryDuplex };
