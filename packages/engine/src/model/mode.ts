import { AnimaeError } from "../types.ts";
import type { AnimaeConfig } from "../schema/authored.ts";
import {
  RUNTIME_MODE_PRESET_VALUES,
  isRuntimeModePreset,
  type Backend,
  type ModelsInfo,
  type RuntimeMode,
  type RuntimeModePreset,
  type RuntimeModeRequest,
} from "../runtime/types.ts";
import type { ResolvedModels } from "./config.ts";
import { RULE_MODEL_ID } from "./rule-port.ts";

/** Which roles a model can serve, given the resolved ports. */
export function availabilityOf(models: ResolvedModels): { s1: boolean; s2: boolean } {
  return { s1: models.s1 !== undefined, s2: models.tiers !== undefined };
}

/**
 * The mode an engine starts under. Priority: an explicit override (CLI `--mode`, `createEngine({ mode })`), the per-role
 * `appraise.backend` / `render.backend`, then `mode` (`llm` | `hybrid` | `rule`). Without any of them a role runs on its
 * model when one is configured, otherwise on the rule backend. Asking for `llm` on a role that has no model is an error.
 */
export function resolveInitialMode(
  config: AnimaeConfig,
  avail: { s1: boolean; s2: boolean },
  override?: RuntimeModeRequest | RuntimeModePreset,
): RuntimeMode {
  const inferred = (has: boolean): Backend => (has ? "llm" : "rule");
  let appraise: Backend = inferred(avail.s1);
  let render: Backend = inferred(avail.s2);

  if (config.mode === "llm") {
    appraise = "llm";
    render = "llm";
  } else if (config.mode === "rule") {
    appraise = "rule";
    render = "rule";
  }
  if (config.appraise?.backend) appraise = config.appraise.backend;
  if (config.render?.backend) render = config.render.backend;

  let s2Tier: string | undefined;
  if (override !== undefined) {
    if (typeof override === "string") {
      if (!isRuntimeModePreset(override)) {
        throw new AnimaeError("MODE_INVALID", `unknown runtime mode "${override}" (expected full, judge-only, narrate-only or rule)`);
      }
      ({ appraise, render } = RUNTIME_MODE_PRESET_VALUES[override]);
    } else {
      appraise = override.appraise ?? appraise;
      render = override.render ?? render;
      s2Tier = override.s2Tier;
    }
  }

  if (appraise === "llm" && !avail.s1) {
    throw new AnimaeError(
      "MODEL_CONFIG",
      "the S1 role is set to run on a model, but none is configured: set `models.s1` in animae.yaml or pass `models.s1` to createEngine (or run it with `appraise.backend: rule`)",
    );
  }
  if (render === "llm" && !avail.s2) {
    throw new AnimaeError(
      "MODEL_CONFIG",
      "the S2 role is set to run on a model, but none is configured: set `models.s2` in animae.yaml or pass `models.s2` to createEngine (or run it with `render.backend: rule`)",
    );
  }
  return { appraise, render, ...(render === "llm" && s2Tier ? { s2Tier } : {}) };
}

/** The model landscape of an engine, safe to show in UIs. */
export function modelsInfoOf(models: ResolvedModels): ModelsInfo {
  const tiers = models.tiers;
  const defaultTier = tiers?.get(tiers.routing.render ?? tiers.defaultId);
  return {
    s1: models.s1?.id ?? RULE_MODEL_ID,
    s2: defaultTier?.port.id ?? RULE_MODEL_ID,
    s1Llm: models.s1 !== undefined,
    s2Tiers: (tiers?.list ?? []).map((t) => ({ id: t.id, model: t.port.id, tags: [...(t.port.tags ?? [])] })),
    ...(tiers ? { s2Default: tiers.routing.render ?? tiers.defaultId } : {}),
    ...(tiers?.routing.escalate_to ? { s2Escalate: tiers.routing.escalate_to } : {}),
  };
}
