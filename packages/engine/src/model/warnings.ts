import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

/** Pluggable sink for AI SDK / model configuration warnings (never stdout/stderr). */
export type ModelWarningEntry = {
  message: string;
  provider?: string;
  model?: string;
  code?: string;
};

export type ModelWarningSink = (entry: ModelWarningEntry) => void;

type AiSdkWarning = {
  type: string;
  feature?: string;
  details?: string;
  setting?: string;
  message?: string;
};

function formatAiSdkWarning(
  warning: AiSdkWarning,
  provider?: string,
  model?: string,
): string {
  const scope = provider != null && model != null ? ` (${provider} / ${model})` : "";
  const prefix = `AI SDK Warning${scope}:`;
  switch (warning.type) {
    case "unsupported":
      return `${prefix} The feature "${warning.feature ?? "?"}" is not supported.${warning.details ? ` ${warning.details}` : ""}`;
    case "compatibility":
      return `${prefix} The feature "${warning.feature ?? "?"}" is used in a compatibility mode.${warning.details ? ` ${warning.details}` : ""}`;
    case "deprecated":
      return `${prefix} Deprecated: "${warning.setting ?? "?"}". ${warning.message ?? ""}`;
    case "other":
      return `${prefix} ${warning.message ?? JSON.stringify(warning)}`;
    default:
      return `${prefix} ${JSON.stringify(warning)}`;
  }
}

const globalDedupe = new Set<string>();
const sinks = new Set<ModelWarningSink>();
let handlerInstalled = false;

function dedupeKey(entry: ModelWarningEntry): string {
  return `${entry.code ?? ""}|${entry.provider ?? ""}|${entry.model ?? ""}|${entry.message}`;
}

function dispatch(entry: ModelWarningEntry) {
  const key = dedupeKey(entry);
  if (globalDedupe.has(key)) return;
  globalDedupe.add(key);
  for (const sink of sinks) {
    try {
      sink(entry);
    } catch {
      /* sink must not break model calls */
    }
  }
}

const registeredSinkRefs = new WeakSet<ModelWarningSink>();

/** Register a warning sink and ensure the AI SDK uses it instead of console/process.emitWarning. */
export function registerModelWarningSink(sink: ModelWarningSink): () => void {
  if (!registeredSinkRefs.has(sink)) {
    registeredSinkRefs.add(sink);
    sinks.add(sink);
  }
  installAiSdkWarningHandler();
  return () => {
    sinks.delete(sink);
    registeredSinkRefs.delete(sink);
  };
}

/** Idempotent: routes AI SDK warnings to registered sinks only. */
export function installAiSdkWarningHandler(): void {
  if (handlerInstalled) return;
  handlerInstalled = true;
  globalThis.AI_SDK_LOG_WARNINGS = (options: {
    warnings: AiSdkWarning[];
    provider?: string;
    model?: string;
  }) => {
    for (const warning of options.warnings) {
      dispatch({
        message: formatAiSdkWarning(warning, options.provider, options.model),
        provider: options.provider,
        model: options.model,
        code: "AI_SDK_WARNING",
      });
    }
  };
}

/** Append de-duplicated warnings to a log file (async, best-effort). */
export function createFileModelWarningSink(logPath: string): ModelWarningSink {
  return (entry) => {
    const line = `[${new Date().toISOString()}] ${entry.message}\n`;
    void (async () => {
      try {
        await mkdir(dirname(logPath), { recursive: true });
        await appendFile(logPath, line, "utf8");
      } catch {
        /* ignore log failures */
      }
    })();
  };
}

/** In-memory sink for tests (dedupe handled by dispatch). */
export function createMemoryModelWarningSink(store: ModelWarningEntry[]): ModelWarningSink {
  return (entry) => {
    store.push(entry);
  };
}

const missingKeyWarned = new Set<string>();

/** Rough token estimate (~4 chars per token) for preflight context warnings. */
export function estimatePromptTokensFromChars(charCount: number): number {
  return Math.ceil(charCount / 4);
}

export function warnOllamaContextBudget(
  spec: Pick<import("../schema/authored.ts").ModelSpec, "provider" | "model">,
  numCtx: number,
  estimatedPromptTokens: number,
  sink?: ModelWarningSink,
): void {
  if (spec.provider !== "ollama") return;
  if (estimatedPromptTokens <= numCtx * 0.85) return;
  const message =
    `Ollama prompt may exceed num_ctx=${numCtx} (~${estimatedPromptTokens} est. input tokens); ` +
    "raise models.*.options.num_ctx or shorten static/semiStatic prompts to avoid silent truncation";
  const entry: ModelWarningEntry = { message, provider: spec.provider, model: spec.model, code: "OLLAMA_CTX_BUDGET" };
  if (sink) sink(entry);
  else dispatch(entry);
}

export function warnMissingApiKey(
  provider: string,
  envName: string,
  sink?: ModelWarningSink,
): void {
  const key = `${provider}:${envName}`;
  if (missingKeyWarned.has(key)) return;
  missingKeyWarned.add(key);
  const message = `API key for ${provider} not set (env ${envName}); requests may fail with 401`;
  if (sink) {
    sink({ message, provider, code: "MODEL_API_KEY_MISSING" });
  } else {
    dispatch({ message, provider, code: "MODEL_API_KEY_MISSING" });
  }
}

/** Reset module state (tests only). */
const fileSinksByPath = new Map<string, ModelWarningSink>();

/** File sink registered once per log path. */
export function fileModelWarningSink(logPath: string): ModelWarningSink {
  let sink = fileSinksByPath.get(logPath);
  if (!sink) {
    sink = createFileModelWarningSink(logPath);
    fileSinksByPath.set(logPath, sink);
    registerModelWarningSink(sink);
  }
  return sink;
}

export function resetModelWarningState(): void {
  globalDedupe.clear();
  missingKeyWarned.clear();
  sinks.clear();
  fileSinksByPath.clear();
  handlerInstalled = false;
  delete (globalThis as { AI_SDK_LOG_WARNINGS?: unknown }).AI_SDK_LOG_WARNINGS;
}
