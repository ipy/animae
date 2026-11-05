import type { Policy, RuleLayer } from "../schema/policy.ts";
import type { ValidationIssue } from "./validate.ts";

/** What the readiness check needs to know about the content outside the policy. */
export interface RuleReadinessOptions {
  /** File name used in the issues (default `policy`). */
  file?: string;
  /**
   * Whether a string-table key (`$t:key`, `{{ t.key }}`) resolves in the locale chain the game plays in. Omit it to skip
   * the string-key check.
   */
  hasString?: (key: string) => boolean;
}

const T_KEY = /\$t:([a-zA-Z0-9_.-]+)/g;
const T_MUSTACHE = /\{\{\s*t\.([a-zA-Z0-9_.-]+)\s*\}\}/g;

function stringKeysOf(text: string): string[] {
  const keys = new Set<string>();
  for (const re of [T_KEY, T_MUSTACHE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) keys.add(m[1]!);
  }
  return [...keys];
}

const isNarrationLine = (entry: { style?: string }) => entry.style === "narration" || entry.style === "narration_break";

/** An utterance layer that always applies: what saves a turn from the built-in `…`. */
function isCatchAll(layer: RuleLayer): boolean {
  return layer.when.trim() === "true" && !layer.pool.every(isNarrationLine);
}

/**
 * Whether the content can be played end to end under the rule backend (`animae validate --mode rule`). The rule
 * backend degrades instead of failing, so each finding says what the player would miss:
 *  - errors: a turn could print only the built-in `…` (no catch-all line), or a line points at a string key that no
 *    locale of the chain defines (the player would read the key);
 *  - warnings: features that are silently skipped without their rule-mode template (reflection summaries, offscreen
 *    traces, autonomous exchanges, quick replies).
 */
export function checkRuleModeReadiness(policy: Policy, opts: RuleReadinessOptions = {}): ValidationIssue[] {
  const file = opts.file ?? "policy";
  const issues: ValidationIssue[] = [];
  const error = (path: string, message: string) => issues.push({ file, path, message });
  const warn = (path: string, message: string) => issues.push({ file, path, message, warn: true });

  const layers = policy.render?.layers ?? [];
  const fallback = policy.render?.fallback;
  if (!fallback && !layers.some(isCatchAll)) {
    error(
      "render",
      "rule mode has nothing to say when no layer matches: set `render.fallback` or add an utterance layer with `when: \"true\"`",
    );
  }

  const texts: Array<{ path: string; text: string }> = [];
  const addLayers = (base: string, list: readonly RuleLayer[]) => {
    list.forEach((layer, li) => layer.pool.forEach((entry, pi) => texts.push({ path: `${base}[${li}].pool[${pi}].text`, text: entry.text })));
  };
  addLayers("render.layers", layers);
  if (fallback) texts.push({ path: "render.fallback.text", text: fallback.text });
  addLayers("scene.autonomous.rules", policy.scene?.autonomous?.rules ?? []);
  (policy.choices?.rules ?? []).forEach((rule, i) => texts.push({ path: `choices.rules[${i}].text`, text: rule.text }));
  if (policy.reflection?.summaryTemplate) texts.push({ path: "reflection.summaryTemplate", text: policy.reflection.summaryTemplate });
  if (policy.offscreen?.narrateTemplate) texts.push({ path: "offscreen.narrateTemplate", text: policy.offscreen.narrateTemplate });
  if (policy.memory?.writing?.template) texts.push({ path: "memory.writing.template", text: policy.memory.writing.template });

  if (opts.hasString) {
    for (const { path, text } of texts) {
      for (const key of stringKeysOf(text)) {
        if (!opts.hasString(key)) error(path, `string key "${key}" is not defined for any locale of the chain`);
      }
    }
  }

  const reflectionOn = policy.reflection?.enabled !== false;
  if (reflectionOn && !policy.reflection?.summaryTemplate) {
    warn("reflection.summaryTemplate", "no summary template: reflections are not written under the rule backend");
  }
  const fidelity = policy.offscreen?.fidelity;
  const narratesOffscreen =
    fidelity !== undefined &&
    [fidelity.default, ...Object.values(fidelity.locations), ...Object.values(fidelity.characters)].some((f) => f === "narrate" || f === "full");
  if (narratesOffscreen && !policy.offscreen?.narrateTemplate) {
    warn("offscreen.narrateTemplate", "no narrate template: offscreen traces are not written under the rule backend");
  }
  const autonomous = policy.scene?.autonomous;
  if (autonomous && autonomous.maxExchangesPerPlayerTurn > 0 && !(autonomous.rules?.length)) {
    warn("scene.autonomous.rules", "no template layers: autonomous exchanges are skipped under the rule backend");
  }
  if (policy.choices?.enabled && !(policy.choices.rules?.length)) {
    warn("choices.rules", "choices are enabled but no rules are set: the rule backend offers no quick replies");
  }
  return issues;
}
