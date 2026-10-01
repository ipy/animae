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

const liveSpecByPort = new WeakMap<ModelPort, { current: ModelSpec }>();

/** Update the spec used by subsequent model calls on a port created with a live spec ref. */
export function syncModelPortSpec(port: ModelPort, spec: ModelSpec): void {
  const ref = liveSpecByPort.get(port);
  if (ref) ref.current = spec;
}

function wireWarningSinks(opts: ModelPortOptions): ModelWarningSink | undefined {
  installAiSdkWarningHandler();
  if (opts.warningLogPath) fileModelWarningSink(opts.warningLogPath);
  if (opts.warningSink) registerModelWarningSink(opts.warningSink);
  return opts.warningSink;
}

export function createModelPort(spec: ModelSpec, opts: ModelPortOptions = {}): ModelPort {
  const env = opts.env ?? (typeof process !== "undefined" ? process.env : {});
  const warningSink = wireWarningSinks(opts);
  const specRef = opts.specRef ?? { current: spec };
  specRef.current = spec;
  const portOpts = { ...opts, env, warningSink, specRef };
  const model: LanguageModel =
    opts.model ?? createLanguageModel(spec, { env, fetch: opts.fetch, warningSink: portOpts.warningSink });
  const id = modelPortId(spec);
  const tracker = new UsageTracker();
  const tags = spec.tags?.length ? [...spec.tags] : [];
  const getSpec = () => portOpts.specRef!.current;

  const port: ModelPort = {
    id,
    tags,
    object<T>(req: ModelRequestBase & { schema: import("zod").ZodType<T> }) {
      return runObjectWithRepair(model, getSpec(), req, tracker, portOpts);
    },
    stream(req: ModelRequestBase & { schema: import("zod").ZodType<unknown> }) {
      return runStream(model, getSpec(), req, tracker, portOpts);
    },
    usage(): Usage {
      return tracker.snapshot();
    },
  };
  liveSpecByPort.set(port, specRef);
  return port;
}
