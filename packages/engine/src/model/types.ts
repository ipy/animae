import type { Usage } from "../types.ts";
import type { ModelWarningSink } from "./warnings.ts";

export type ModelPortOptions = {
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  usageSink?: (usage: Usage) => void;
  /** AI SDK / model warnings (never written to stdout/stderr by the engine) */
  warningSink?: ModelWarningSink;
  /** append warnings to this file when `warningSink` is not set */
  warningLogPath?: string;
  /** injectable sleep for retry tests (ms) */
  sleep?: (ms: number) => Promise<void>;
  /** max transient retries (429/5xx/network); default 3 */
  maxTransientRetries?: number;
  /** override language model (tests) */
  model?: import("ai").LanguageModel;
};

export type RecordedObjectResponse = unknown;

export type RecordedStreamResponse = import("../ports.ts").StreamPart[];
