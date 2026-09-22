import type { ZodType } from "zod";
import type { ModelPort, ModelRequestBase, StreamPart } from "../ports.ts";
import type { Usage } from "../types.ts";

export type ScriptedHandler = (
  req: ModelRequestBase & { schema: ZodType<unknown> },
) => unknown | AsyncIterable<unknown> | Promise<unknown | AsyncIterable<unknown>>;

export function streamFromObject(obj: Record<string, unknown>, chunkSize = 4): AsyncIterable<{ text: string }> {
  const full = JSON.stringify(obj);
  async function* gen() {
    let acc = "";
    for (let i = 0; i < full.length; i += chunkSize) {
      acc += full.slice(i, i + chunkSize);
      yield { text: acc };
    }
  }
  return gen();
}

export function createScriptedModel(
  id: string,
  handler: ScriptedHandler,
  usageSeed?: Usage,
  opts?: { tags?: readonly string[] },
): ModelPort {
  let cumulative: Usage = usageSeed ?? { inputTokens: 0, outputTokens: 0 };
  const tags = opts?.tags?.length ? [...opts.tags] : [];

  return {
    id,
    tags,
    usage() {
      return { ...cumulative };
    },
    async object<T>(req: ModelRequestBase & { schema: ZodType<T> }): Promise<T> {
      const out = await handler(req);
      if (isAsyncIterable(out)) {
        let last: unknown;
        for await (const p of out) last = p;
        return req.schema.parse(last) as T;
      }
      return req.schema.parse(out) as T;
    },
    stream(req: ModelRequestBase & { schema: ZodType<unknown> }) {
      return runScriptedStream(handler, req, (u) => {
        cumulative = u;
      });
    },
  };
}

function isAsyncIterable(v: unknown): v is AsyncIterable<unknown> {
  return v != null && typeof (v as AsyncIterable<unknown>)[Symbol.asyncIterator] === "function";
}

async function* runScriptedStream(
  handler: ScriptedHandler,
  req: ModelRequestBase & { schema: ZodType<unknown> },
  onUsage: (u: Usage) => void,
): AsyncGenerator<StreamPart> {
  const out = await handler(req);
  if (isAsyncIterable(out)) {
    let last: unknown;
    for await (const partial of out) {
      last = partial;
      yield { type: "partial", value: partial };
    }
    const value = req.schema.parse(last);
    const usage: Usage = { inputTokens: 1, outputTokens: 1 };
    onUsage(usage);
    yield { type: "final", value, usage };
    return;
  }
  const value = req.schema.parse(out);
  yield { type: "partial", value };
  const usage: Usage = { inputTokens: 1, outputTokens: 1 };
  onUsage(usage);
  yield { type: "final", value, usage };
}

/** @deprecated alias */
export const ScriptedModel = createScriptedModel;
