import { AnimaeError } from "../types.ts";
import type { AnimaeConfig, S2Routing, S2TierSpec } from "../schema/authored.ts";
import { isModelPort, type EngineModels, type ModelPort } from "../ports.ts";
import { createModelPort } from "./port.ts";
import { createTierResolver, singleTierResolver, type S2Tier, type TierResolver } from "./tier-resolver.ts";
import type { ModelPortOptions } from "./types.ts";

/** The model ports an engine is built with. A role without a port is served by the rule backend only. */
export interface ResolvedModels {
  /** The LLM port of the S1 role, if one is configured. */
  s1?: ModelPort;
  /** The S2 tiers, if any model serves the S2 role. */
  tiers?: TierResolver;
}

function s2TierSpecs(config: AnimaeConfig): { tiers: S2TierSpec[]; default?: string; routing?: S2Routing } | undefined {
  const s2 = config.models?.s2;
  if (!s2) return undefined;
  if ("tiers" in s2) return { tiers: s2.tiers, default: s2.default, routing: s2.routing };
  return undefined;
}

/**
 * Builds the S1 port and the S2 tiers from what the embedder passed and from `animae.yaml`. Explicit ports win over the
 * config; `provider: rule` (or no entry) leaves the role to the rule backend.
 */
export function createModelsFromConfig(config: AnimaeConfig, opts: ModelPortOptions = {}): ResolvedModels {
  const out: ResolvedModels = {};
  const s1 = config.models?.s1;
  if (s1 && s1.provider !== "rule") out.s1 = createModelPort(s1, opts);

  const tiered = s2TierSpecs(config);
  if (tiered) {
    const tiers: S2Tier[] = tiered.tiers.map((t) => {
      const { id, ...spec } = t;
      return { id, port: createModelPort(spec, opts) };
    });
    out.tiers = createTierResolver(tiers, { default: tiered.default, routing: tiered.routing });
  } else if (config.models?.s2 && !("tiers" in config.models.s2)) {
    out.tiers = singleTierResolver(createModelPort(config.models.s2, opts));
  }
  return out;
}

/** Resolve the S1 port and the S2 tiers from explicit opts or authored config. */
export function resolveEngineModels(
  opts: { models?: EngineModels },
  config: AnimaeConfig,
  portOpts: ModelPortOptions = {},
): ResolvedModels {
  const fromConfig = createModelsFromConfig(config, portOpts);
  const given = opts.models;
  const out: ResolvedModels = { ...fromConfig };
  if (given?.s1) {
    if (!isModelPort(given.s1)) throw new AnimaeError("MODEL_CONFIG", "models.s1 must be a ModelPort");
    out.s1 = given.s1;
  }
  if (given?.s2) {
    if (isModelPort(given.s2)) {
      out.tiers = singleTierResolver(given.s2);
    } else {
      if (!Array.isArray(given.s2.tiers) || given.s2.tiers.length === 0) {
        throw new AnimaeError("MODEL_CONFIG", "models.s2.tiers must list at least one { id, port }");
      }
      for (const t of given.s2.tiers) {
        if (!isModelPort(t.port)) throw new AnimaeError("MODEL_CONFIG", `models.s2.tiers["${t.id}"].port must be a ModelPort`);
      }
      out.tiers = createTierResolver(given.s2.tiers, { default: given.s2.default, routing: given.s2.routing });
    }
  }
  return out;
}
