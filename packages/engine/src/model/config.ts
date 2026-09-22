import { AnimaeError } from "../types.ts";
import type { AnimaeConfig } from "../schema/authored.ts";
import type { ModelPort } from "../ports.ts";
import { createModelPort } from "./port.ts";
import type { ModelPortOptions } from "./types.ts";

const MODELS_REQUIRED =
  "createEngine requires two ModelPorts (models.s1 and models.s2) or animae.yaml models.s1 and models.s2";

export function createModelsFromConfig(config: AnimaeConfig, opts: ModelPortOptions = {}) {
  if (!config.models?.s1 || !config.models?.s2) {
    throw new AnimaeError("MODEL_CONFIG", MODELS_REQUIRED);
  }
  return {
    s1: createModelPort(config.models.s1, opts),
    s2: createModelPort(config.models.s2, opts),
  };
}

/** Resolve S1/S2 model ports from explicit opts or authored config. */
export function resolveEngineModels(
  opts: { models?: { s1: ModelPort; s2: ModelPort } },
  config: AnimaeConfig,
  portOpts: ModelPortOptions = {},
): { s1: ModelPort; s2: ModelPort } {
  if (opts.models) {
    if (!opts.models.s1 || !opts.models.s2) {
      throw new AnimaeError("MODEL_CONFIG", MODELS_REQUIRED);
    }
    return opts.models;
  }
  return createModelsFromConfig(config, portOpts);
}
