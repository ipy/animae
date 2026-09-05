import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  createMemoryModelWarningSink,
  installAiSdkWarningHandler,
  registerModelWarningSink,
  resetModelWarningState,
  resolveApiKey,
} from "../../src/model/index.ts";

/** Same routing AI SDK `logWarnings` uses when `AI_SDK_LOG_WARNINGS` is a function. */
function routeAiSdkWarnings(options: {
  warnings: { type: string; message?: string }[];
  provider?: string;
  model?: string;
}) {
  if (options.warnings.length === 0) return;
  const logger = globalThis.AI_SDK_LOG_WARNINGS;
  if (logger === false) return;
  if (typeof logger === "function") {
    logger(options as never);
  }
}

describe("AI SDK warning handler", () => {
  let stdoutChunks: string[];
  let stderrChunks: string[];
  const origStdout = process.stdout.write.bind(process.stdout);
  const origStderr = process.stderr.write.bind(process.stderr);
  const origEmit = process.emitWarning?.bind(process);

  beforeEach(() => {
    resetModelWarningState();
    stdoutChunks = [];
    stderrChunks = [];
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdoutChunks.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderrChunks.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    if (process.emitWarning) {
      process.emitWarning = ((msg: string) => {
        stderrChunks.push(String(msg));
      }) as typeof process.emitWarning;
    }
  });

  afterEach(() => {
    process.stdout.write = origStdout;
    process.stderr.write = origStderr;
    if (origEmit) process.emitWarning = origEmit;
    resetModelWarningState();
  });

  test("custom handler never writes to stdout/stderr", () => {
    const store: { message: string }[] = [];
    installAiSdkWarningHandler();
    registerModelWarningSink(createMemoryModelWarningSink(store as never));
    routeAiSdkWarnings({
      warnings: [{ type: "other", message: "test warning once" }],
      provider: "openai",
      model: "gpt",
    });
    routeAiSdkWarnings({
      warnings: [{ type: "other", message: "test warning once" }],
      provider: "openai",
      model: "gpt",
    });
    expect(store.length).toBe(1);
    expect(stdoutChunks.join("")).toBe("");
    expect(stderrChunks.join("")).toBe("");
  });
});

describe("resolveApiKey optional", () => {
  beforeEach(() => resetModelWarningState());

  test("returns undefined and warns once for missing hosted key", () => {
    const store: { message: string }[] = [];
    const sink = createMemoryModelWarningSink(store as never);
    installAiSdkWarningHandler();
    expect(resolveApiKey({ provider: "openai", model: "gpt" }, {}, { warningSink: sink })).toBeUndefined();
    expect(resolveApiKey({ provider: "openai", model: "gpt" }, {}, { warningSink: sink })).toBeUndefined();
    expect(store.filter((e) => e.message.includes("OPENAI_API_KEY")).length).toBe(1);
  });
});
