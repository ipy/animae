import {
  generateText,
  isStepCount,
  Output,
  streamText,
  tool,
  type LanguageModel,
  type ModelMessage,
  type TextStreamPart,
  type ToolSet,
} from "ai";
import type { ZodType } from "zod";
import { AnimaeError } from "../types.ts";
import type { ModelRequestBase, StreamPart, ToolDef } from "../ports.ts";
import type { ModelSpec } from "../schema/authored.ts";
import { segmentsToMessages } from "./messages.ts";
import { isOutputValidationError, isTransientError, withTransientRetries } from "./retry.ts";
import type { ModelPortOptions } from "./types.ts";
import { sanitizeStructuredOutput } from "./reasoning.ts";
import { mapUsage, type UsageTracker } from "./usage.ts";

const REPAIR_HINT: ModelMessage = {
  role: "system",
  content: "Your previous response did not match the required JSON schema. Reply with valid JSON only, matching the schema exactly.",
};

function buildTools(defs: ToolDef[] | undefined): ToolSet | undefined {
  if (!defs?.length) return undefined;
  const out: ToolSet = {};
  for (const d of defs) {
    out[d.name] = tool({
      description: d.description,
      inputSchema: d.input,
      execute: async (input) => d.execute(input),
    });
  }
  return out;
}

function providerOptionsFromSpec(spec: ModelSpec): Record<string, unknown> | undefined {
  if (!spec.options || !Object.keys(spec.options).length) return undefined;
  return { [spec.provider]: spec.options };
}

function callSettings(req: ModelRequestBase, spec: ModelSpec) {
  const maxSteps = req.maxSteps ?? (req.tools?.length ? 3 : 1);
  return {
    maxOutputTokens: req.maxOutputTokens,
    temperature: req.temperature,
    seed: req.seed,
    stopWhen: isStepCount(maxSteps),
    providerOptions: providerOptionsFromSpec(spec),
    allowSystemInMessages: true,
  };
}

function finishGenerate<T>(
  result: Awaited<ReturnType<typeof generateText>>,
  tracker: UsageTracker,
  opts: ModelPortOptions,
): T {
  const usage = mapUsage(result.usage);
  tracker.add(usage);
  opts.usageSink?.(usage);
  if (result.output === undefined) {
    throw new AnimaeError("MODEL_OUTPUT_INVALID", "Model returned no structured output");
  }
  return sanitizeStructuredOutput(result.output as T);
}

export async function runObjectWithRepair<T>(
  model: LanguageModel,
  spec: ModelSpec,
  req: ModelRequestBase & { schema: ZodType<T> },
  tracker: UsageTracker,
  opts: ModelPortOptions,
): Promise<T> {
  const baseMessages = segmentsToMessages(req.segments, spec);
  const tools = buildTools(req.tools);
  const settings = callSettings(req, spec);
  const output = Output.object({ schema: req.schema });

  const call = (extra: ModelMessage[]) =>
    withTransientRetries(
      () =>
        generateText({
          model,
          messages: [...baseMessages, ...extra],
          tools,
          output,
          maxRetries: 0,
          ...settings,
        } as unknown as Parameters<typeof generateText>[0]),
      { max: opts.maxTransientRetries, sleep: opts.sleep },
    );

  try {
    return finishGenerate(await call([]), tracker, opts);
  } catch (first) {
    if (!isOutputValidationError(first)) throw first;
    try {
      return finishGenerate(await call([REPAIR_HINT]), tracker, opts);
    } catch (second) {
      throw new AnimaeError("MODEL_OUTPUT_INVALID", "Model output failed schema validation after repair", second);
    }
  }
}

async function* streamOnce(
  model: LanguageModel,
  spec: ModelSpec,
  req: ModelRequestBase & { schema: ZodType<unknown> },
  tracker: UsageTracker,
  opts: ModelPortOptions,
  extraMessages: ModelMessage[],
): AsyncGenerator<StreamPart> {
  const messages = [...segmentsToMessages(req.segments, spec), ...extraMessages];
  const tools = buildTools(req.tools);
  const settings = callSettings(req, spec);
  const output = Output.object({ schema: req.schema });

  const queue: StreamPart[] = [];
  let wake: (() => void) | undefined;
  const push = (p: StreamPart) => {
    queue.push(p);
    wake?.();
  };

  const result = streamText({
    model,
    messages,
    tools,
    output,
    maxRetries: 0,
    ...settings,
    onChunk(event: { chunk: TextStreamPart<ToolSet> }) {
      const { chunk } = event;
      if (chunk.type === "tool-result") {
        push({ type: "tool", name: chunk.toolName, input: chunk.input, output: chunk.output });
      }
    },
  } as unknown as Parameters<typeof streamText>[0]);

  let streamError: unknown;
  const partialTask = (async () => {
    try {
      for await (const partial of result.partialOutputStream) {
        push({ type: "partial", value: sanitizeStructuredOutput(partial) });
      }
    } catch (e) {
      streamError = e;
      wake?.();
    }
  })();

  let textDone = false;
  void Promise.resolve(result.text)
    .then(() => {
      textDone = true;
      wake?.();
    })
    .catch((e: unknown) => {
      streamError = e;
      textDone = true;
      wake?.();
    });

  while (!textDone || queue.length > 0) {
    while (queue.length) yield queue.shift()!;
    if (!textDone) {
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
  }

  await partialTask;
  if (streamError) throw streamError;

  let value: unknown;
  try {
    value = await result.output;
  } catch (e) {
    throw e;
  }

  const usage = mapUsage(await result.usage);
  tracker.add(usage);
  opts.usageSink?.(usage);
  yield { type: "final", value: sanitizeStructuredOutput(value), usage };
}

export async function* runStream(
  model: LanguageModel,
  spec: ModelSpec,
  req: ModelRequestBase & { schema: ZodType<unknown> },
  tracker: UsageTracker,
  opts: ModelPortOptions,
): AsyncGenerator<StreamPart> {
  const maxTransient = opts.maxTransientRetries ?? 3;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  for (let repair = 0; repair < 2; repair++) {
    const extra = repair === 1 ? [REPAIR_HINT] : [];
    for (let attempt = 0; attempt <= maxTransient; attempt++) {
      try {
        yield* streamOnce(model, spec, req, tracker, opts, extra);
        return;
      } catch (e) {
        const validation = isOutputValidationError(e);
        if (validation && repair === 0) break;
        if (validation && repair === 1) {
          throw new AnimaeError("MODEL_OUTPUT_INVALID", "Model stream output failed schema validation after repair", e);
        }
        if (isTransientError(e) && attempt < maxTransient) {
          await sleep(200 * 2 ** attempt);
          continue;
        }
        throw e;
      }
    }
  }
}
