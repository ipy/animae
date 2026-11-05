import type { RuleLayer, RulePoolEntry } from "../schema/policy.ts";
import type { RuleEnv } from "./env.ts";
import { weightedPick } from "./rng.ts";
import { renderTemplate, renderTemplateDeep } from "./template.ts";

/** What the S2 render answer looks like before it goes through the same schema an LLM answer does. */
export interface RuleRenderOutput {
  text: string;
  cues: { type: string; args: Record<string, unknown>; at?: number }[];
  intent_realized: string;
  choices?: { text: string; expected_event_type: string; tags: string[]; intensity?: number; sincerity?: number; approach?: string }[];
  narrations?: { text: string; style: "normal" | "scene_break" }[];
}

/** Last-resort utterance when neither a layer nor `render.fallback` supplies one. */
const BUILTIN_FALLBACK_TEXT = "…";

export function isNarrationEntry(entry: RulePoolEntry): boolean {
  return entry.style === "narration" || entry.style === "narration_break";
}

/** A layer whose every line is narration; such layers add paragraphs and never supply the utterance. */
export function isNarrationLayer(layer: RuleLayer): boolean {
  return layer.pool.every(isNarrationEntry);
}

function layerApplies(env: RuleEnv, layer: RuleLayer): boolean {
  try {
    return env.k.rules.cel.bool(layer.when, env.vars);
  } catch (e) {
    env.k.warn("RULE_WHEN_ERROR", `render layer "${layer.id}": ${e instanceof Error ? e.message : String(e)}`, { layer: layer.id });
    return false;
  }
}

type RenderedLine = { text: string; cues: RuleRenderOutput["cues"]; intent?: string };

function renderLine(env: RuleEnv, entry: { text: string; cues?: RulePoolEntry["cues"]; intent?: string }): RenderedLine {
  const text = renderTemplate(env.k, entry.text, env.vars, { locale: env.locale }).trim();
  const cues = (entry.cues ?? []).map((c) => {
    const at = c.at === undefined ? undefined : Math.min(c.at, text.length);
    return {
      type: c.type,
      args: renderTemplateDeep(env.k, c.args, env.vars, { locale: env.locale }),
      ...(at !== undefined ? { at } : {}),
    };
  });
  return { text, cues, intent: entry.intent };
}

/**
 * Renders one turn without a model. The first utterance layer whose `when` holds supplies the line (weighted pick);
 * every narration layer whose `when` holds adds one narration paragraph. `intent_realized` is the pool line's `intent`,
 * or the intent the rules decided, so the rule backend never produces an intent mismatch.
 */
export function ruleRender(env: RuleEnv, layers: readonly RuleLayer[]): RuleRenderOutput {
  const { k } = env;
  const utteranceLayers = layers.filter((l) => !isNarrationLayer(l));
  const narrationLayers = layers.filter(isNarrationLayer);

  let line: RenderedLine | undefined;
  const layer = utteranceLayers.find((l) => layerApplies(env, l));
  if (layer) {
    const entry = weightedPick(layer.pool, env.rng);
    const rendered = renderLine(env, entry);
    if (rendered.text) line = rendered;
  }
  if (!line) {
    const fb = k.policy.render.fallback;
    if (fb) {
      const rendered = renderLine(env, fb);
      if (rendered.text) line = rendered;
    }
  }
  line ??= { text: BUILTIN_FALLBACK_TEXT, cues: [] };

  const narrations: NonNullable<RuleRenderOutput["narrations"]> = [];
  for (const nl of narrationLayers) {
    if (!layerApplies(env, nl)) continue;
    const entry = weightedPick(nl.pool, env.rng);
    const rendered = renderLine(env, entry);
    if (!rendered.text) continue;
    narrations.push({ text: rendered.text, style: entry.style === "narration_break" ? "scene_break" : "normal" });
  }

  return {
    text: line.text,
    cues: line.cues,
    intent_realized: line.intent ?? env.ctx.intent?.intent ?? "",
    ...(narrations.length ? { narrations } : {}),
  };
}
