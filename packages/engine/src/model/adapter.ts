import {
  generateText,
  isStepCount,
  NoOutputGeneratedError,
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
import { promptSegmentCharCount, segmentsToMessages } from "./messages.ts";
import { resolveOllamaProviderOptions, resolveOpenAICompatibleProviderOptions } from "./provider.ts";
import { estimatePromptTokensFromChars, warnOllamaContextBudget } from "./warnings.ts";
import { asModelAnimaeError, modelTimeoutError } from "./classify-error.ts";
import {
  isOutputValidationError,
  isTimeoutLikeError,
  isTransientError,
  MAX_TIMEOUT_RETRIES,
  withTransientRetries,
} from "./retry.ts";
import { createStreamWatchdog, resolveModelTimeoutMs } from "./timeout.ts";
import type { ModelPortOptions } from "./types.ts";
import { sanitizeStructuredOutput } from "./reasoning.ts";
import { salvageStructuredFromValidationError } from "./salvage-output.ts";
import { mapUsage, type UsageTracker } from "./usage.ts";

const REPAIR_HINT: ModelMessage = {
  role: "system",
  content:
    "Your previous response did not match the required JSON schema. Reply with a single JSON object only (no markdown fences, no prose outside JSON).",
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

function providerOptionsFromSpec(
  spec: ModelSpec,
  ctx?: { segments?: import("../ports.ts").PromptSegments; warningSink?: import("./warnings.ts").ModelWarningSink },
): Record<string, unknown> | undefined {
  if (spec.provider === "ollama") {
    const ollama = resolveOllamaProviderOptions(spec);
    if (ctx?.segments) {
      const est = estimatePromptTokensFromChars(promptSegmentCharCount(ctx.segments));
      const numCtx = typeof ollama.num_ctx === "number" ? ollama.num_ctx : 8192;
      warnOllamaContextBudget(spec, numCtx, est, ctx.warningSink);
    }
    return { ollama };
  }
  if (spec.provider === "openai-compatible") {
    return { openaiCompatible: resolveOpenAICompatibleProviderOptions(spec) };
  }
  if (!spec.options || !Object.keys(spec.options).length) return undefined;
  const key = spec.provider === "openai" ? "openai" : spec.provider;
  return { [key]: spec.options };
}

function modelCallContext(spec: ModelSpec) {
  const timeoutMs = resolveModelTimeoutMs(spec);
  return { timeoutMs, baseURL: spec.baseURL };
}

/** Non-streaming calls: one total wall-clock limit per attempt. Streams use `createStreamWatchdog`. */
function objectTransportOptions(spec: ModelSpec): { timeout: number } {
  return { timeout: resolveModelTimeoutMs(spec) };
}

function callSettings(
  req: ModelRequestBase,
  spec: ModelSpec,
  ctx?: { warningSink?: import("./warnings.ts").ModelWarningSink },
) {
  const maxSteps = req.maxSteps ?? (req.tools?.length ? 3 : 1);
  return {
    maxOutputTokens: req.maxOutputTokens,
    temperature: req.temperature,
    seed: req.seed,
    stopWhen: isStepCount(maxSteps),
    providerOptions: providerOptionsFromSpec(spec, { segments: req.segments, warningSink: ctx?.warningSink }),
    allowSystemInMessages: true,
  };
}

function rethrowModel(err: unknown, spec: ModelSpec): never {
  throw asModelAnimaeError(err, modelCallContext(spec));
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
    throw new AnimaeError("MODEL_EMPTY", "Model returned no structured output");
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
  const settings = callSettings(req, spec, { warningSink: opts.warningSink });
  const output = Output.object({ schema: req.schema });

  const transport = objectTransportOptions(spec);

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
          ...transport,
        } as unknown as Parameters<typeof generateText>[0]),
      { max: opts.maxTransientRetries, sleep: opts.sleep },
    );

  try {
    return finishGenerate(await call([]), tracker, opts);
  } catch (first) {
    if (!isOutputValidationError(first)) rethrowModel(first, spec);
    try {
      return finishGenerate(await call([REPAIR_HINT]), tracker, opts);
    } catch (second) {
      const salvaged = salvageStructuredFromValidationError(second, req.schema);
      if (salvaged !== undefined) return sanitizeStructuredOutput(salvaged);
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
  const settings = callSettings(req, spec, { warningSink: opts.warningSink });
  const output = Output.object({ schema: req.schema });

  const queue: StreamPart[] = [];
  let wake: (() => void) | undefined;
  const push = (p: StreamPart) => {
    queue.push(p);
    wake?.();
  };

  const timeoutMs = resolveModelTimeoutMs(spec);
  const watchdog = createStreamWatchdog(timeoutMs, () => wake?.());
  let streamError: unknown;
  // The SDK reports transport/provider failures on the stream and then rejects with a generic
  // "No output generated"; keep the first real error so it can be classified, and (by supplying
  // `onError`) stop the SDK from printing it to the console.
  const noteError = (e: unknown) => {
    if (streamError === undefined || NoOutputGeneratedError.isInstance(streamError)) streamError = e;
    wake?.();
  };
  try {
    const result = streamText({
      model,
      messages,
      tools,
      output,
      maxRetries: 0,
      ...settings,
      abortSignal: watchdog.signal,
      onError: ({ error }: { error: unknown }) => noteError(error),
      onChunk(event: { chunk: TextStreamPart<ToolSet> }) {
        const { chunk } = event;
        // `start` / `start-step` are emitted by the SDK itself before the request goes out; only
        // provider output counts as liveness.
        if (chunk.type !== "start" && chunk.type !== "start-step") watchdog.touch();
        if (chunk.type === "tool-result") {
          push({ type: "tool", name: chunk.toolName, input: chunk.input, output: chunk.output });
        }
      },
    } as unknown as Parameters<typeof streamText>[0]);

    const partialTask = (async () => {
      try {
        for await (const partial of result.partialOutputStream) {
          push({ type: "partial", value: sanitizeStructuredOutput(partial) });
        }
      } catch (e) {
        noteError(e);
      }
    })();

    let textDone = false;
    void Promise.resolve(result.text)
      .then(() => {
        textDone = true;
        watchdog.stop();
        wake?.();
      })
      .catch((e: unknown) => {
        textDone = true;
        // A provider failure ends the request: the idle timer must not fire afterwards and relabel it a timeout.
        watchdog.stop();
        noteError(e);
      });

    while (!textDone || queue.length > 0) {
      while (queue.length) yield queue.shift()!;
      if (watchdog.firedPhase) break;
      if (!textDone) {
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    }

    // The SDK may take a moment (or never) to surface our own abort; the watchdog result is authoritative.
    if (watchdog.firedPhase) throw modelTimeoutError(timeoutMs, watchdog.firedPhase, streamError);

    await partialTask;
    if (streamError) rethrowModel(streamError, spec);

    let value: unknown;
    try {
      value = await result.output;
    } catch (e) {
      const salvaged = isOutputValidationError(e)
        ? salvageStructuredFromValidationError(e, req.schema)
        : undefined;
      if (salvaged === undefined) rethrowModel(e, spec);
      value = salvaged;
    }

    const usage = mapUsage(await result.usage);
    tracker.add(usage);
    opts.usageSink?.(usage);
    yield { type: "final", value: sanitizeStructuredOutput(value), usage };
  } finally {
    watchdog.stop();
  }
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

  let timeoutRetries = 0;
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
          const salvaged = salvageStructuredFromValidationError(e, req.schema);
          if (salvaged !== undefined) {
            yield { type: "final", value: sanitizeStructuredOutput(salvaged) };
            return;
          }
          throw new AnimaeError("MODEL_OUTPUT_INVALID", "Model stream output failed schema validation after repair", e);
        }
        if (isTransientError(e) && attempt < maxTransient) {
          if (isTimeoutLikeError(e)) {
            if (timeoutRetries >= MAX_TIMEOUT_RETRIES) rethrowModel(e, spec);
            timeoutRetries += 1;
          }
          await sleep(200 * 2 ** attempt);
          continue;
        }
        rethrowModel(e, spec);
      }
    }
  }
  rethrowModel(new Error("stream retries exhausted"), spec);
}
