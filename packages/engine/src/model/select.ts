import type { Kernel } from "../contracts.ts";
import type { ModelPort } from "../ports.ts";
import type { ModelSpec } from "../schema/authored.ts";
import type { AppraiseBinding, Backend, RenderBinding, RuntimeMode } from "../runtime/types.ts";
import { createRuleModelPort } from "./rule-port.ts";
import { singleTierResolver, type TierResolver } from "./tier-resolver.ts";

/** The mode of an engine without a mode controller (tests, tools): both roles on models. */
export const FULL_MODE: Readonly<RuntimeMode> = Object.freeze({ appraise: "llm", render: "llm" });

const ruleCache = new WeakMap<object, ModelPort>();

/** The rule-backend port of this kernel (the one the engine assembled, else one built on first use). */
export function ruleModelOf(k: Kernel): ModelPort {
  if (k.models.rule) return k.models.rule;
  let port = ruleCache.get(k.models);
  if (!port) {
    port = createRuleModelPort(k);
    ruleCache.set(k.models, port);
  }
  return port;
}

/** The S2 tiers of this kernel (a single tier `only` when the engine was given one S2 port). */
export function tiersOf(k: Kernel): TierResolver {
  return k.models.tiers ?? singleTierResolver(k.models.s2);
}

/** Which roles a model can serve at all. */
export function llmRoles(k: Kernel): { s1: boolean; s2: boolean } {
  return k.models.llm ?? { s1: true, s2: true };
}

/** The mode new turns start under. */
export function currentMode(k: Kernel): RuntimeMode {
  return k.runtime ? k.runtime.mode() : { ...FULL_MODE };
}

/** The S1 role served by `backend`, falling back to the rule port when no model is configured for it. */
export function s1PortFor(k: Kernel, backend: Backend): ModelPort {
  return backend === "llm" && llmRoles(k).s1 ? k.models.s1 : ruleModelOf(k);
}

/** The binding `route.decided.appraise` records for a backend. */
export function appraiseBindingFor(k: Kernel, backend: Backend): AppraiseBinding {
  if (backend === "llm" && llmRoles(k).s1) return { backend: "llm", slot: "s1", model: k.models.s1.id };
  return { backend: "rule" };
}

/** The port that serves a render binding. */
export function s2PortFor(k: Kernel, binding: RenderBinding): ModelPort {
  if (binding.backend === "rule") return ruleModelOf(k);
  return tiersOf(k).get(binding.tier)?.port ?? k.models.s2;
}

/** Binding of an S2 tier, or the rule backend when the tier is unknown or no model serves S2. */
export function renderBindingFor(k: Kernel, tier: string | undefined): RenderBinding {
  if (!llmRoles(k).s2 || tier === undefined) return { backend: "rule" };
  const t = tiersOf(k).get(tier);
  if (!t) return { backend: "rule" };
  return { backend: "llm", slot: "s2", tier: t.id, model: t.port.id };
}

/** The configured model spec behind S1 (undefined for the rule backend, an injected port, or no config). */
export function s1SpecOf(k: Kernel): ModelSpec | undefined {
  const spec = k.authored.config.models?.s1;
  return spec && spec.provider !== "rule" ? spec : undefined;
}

/** The configured model spec behind an S2 tier (the default tier when `tier` is omitted). */
export function s2SpecOf(k: Kernel, tier?: string): ModelSpec | undefined {
  const s2 = k.authored.config.models?.s2;
  if (!s2) return undefined;
  if ("tiers" in s2) {
    const id = tier ?? s2.default ?? s2.tiers[0]?.id;
    return s2.tiers.find((t) => t.id === id);
  }
  return s2;
}

/** Timeout and endpoint of a spec, for classifying a failed call. */
export function modelErrorContext(
  spec: ModelSpec | undefined,
  timeoutMs: (s: ModelSpec) => number,
): { timeoutMs: number; baseURL?: string } | undefined {
  return spec ? { timeoutMs: timeoutMs(spec), ...(spec.baseURL ? { baseURL: spec.baseURL } : {}) } : undefined;
}
