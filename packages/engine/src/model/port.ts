import type { LanguageModel } from "ai";
import type { ModelPort, ModelRequestBase } from "../ports.ts";
import type { ModelSpec } from "../schema/authored.ts";
import type { Usage } from "../types.ts";
import { runObjectWithRepair, runStream } from "./adapter.ts";
import { createLanguageModel, modelPortId } from "./provider.ts";
import type { ModelPortOptions } from "./types.ts";
import { UsageTracker } from "./usage.ts";
import {
  fileModelWarningSink,
  installAiSdkWarningHandler,
  registerModelWarningSink,
  type ModelWarningSink,
} from "./warnings.ts";

function wireWarningSinks(opts: ModelPortOptions): ModelWarningSink | undefined {
  installAiSdkWarningHandler();
  if (opts.warningLogPath) fileModelWarningSink(opts.warningLogPath);
  if (opts.warningSink) registerModelWarningSink(opts.warningSink);
  return opts.warningSink;
}

export function createModelPort(spec: ModelSpec, opts: ModelPortOptions = {}): ModelPort {
  const env = opts.env ?? (typeof process !== "undefined" ? process.env : {});
  const warningSink = wireWarningSinks(opts);
  const portOpts = { ...opts, env, warningSink };
  const model: LanguageModel =
    opts.model ?? createLanguageModel(spec, { env, fetch: opts.fetch, warningSink: portOpts.warningSink });
  const id = modelPortId(spec);
  const tracker = new UsageTracker();
  const tags = spec.tags?.length ? [...spec.tags] : [];

  return {
    id,
    tags,
    object<T>(req: ModelRequestBase & { schema: import("zod").ZodType<T> }) {
      return runObjectWithRepair(model, spec, req, tracker, portOpts);
    },
    stream(req: ModelRequestBase & { schema: import("zod").ZodType<unknown> }) {
      return runStream(model, spec, req, tracker, portOpts);
    },
    usage(): Usage {
      return tracker.snapshot();
    },
  };
}
