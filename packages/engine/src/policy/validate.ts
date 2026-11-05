import { celCheck } from "../rules/cel.ts";
import { templateExpressions } from "../rule-backend/template.ts";
import type { Level } from "../schema/common.ts";
import type { FieldDef } from "../schema/authored.ts";
import type { Policy, ResolvedPolicy, RuleLayer } from "../schema/policy.ts";
import { PolicySchema } from "../schema/policy.ts";
import { applyPolicyDefaults, levelRank } from "./defaults.ts";

export type ValidationIssue = { file: string; path: string; message: string; warn?: boolean };

export interface CrossValidateOptions {
  file?: string;
  knownRuleFns?: Set<string>;
  authoredFields?: Record<string, Pick<FieldDef, "level">>;
}

function validateTracks(policy: Policy, file: string, issues: ValidationIssue[]): void {
  const tracks = policy.tracks ?? {};
  for (const [name, def] of Object.entries(tracks)) {
    const base = `tracks.${name}`;
    if (def.initial < def.min || def.initial > def.max) {
      issues.push({
        file,
        path: `${base}.initial`,
        message: `initial ${def.initial} must be within [${def.min}, ${def.max}]`,
      });
    }
    const tiers = def.tiers ?? [];
    let prev = -Infinity;
    const names = new Set<string>();
    for (let i = 0; i < tiers.length; i++) {
      const t = tiers[i]!;
      if (names.has(t.name)) {
        issues.push({ file, path: `${base}.tiers[${i}].name`, message: `duplicate tier name "${t.name}"` });
      }
      names.add(t.name);
      if (t.from < prev) {
        issues.push({ file, path: `${base}.tiers[${i}].from`, message: "tiers must be sorted by ascending from" });
      }
      prev = t.from;
    }
  }
}

function validateRefs(policy: Policy, file: string, issues: ValidationIssue[], opts: CrossValidateOptions): void {
  const eventTypes = new Set(Object.keys(policy.events?.types ?? {}));
  eventTypes.add("other");
  const trackNames = new Set(Object.keys(policy.tracks ?? {}));
  const intentTypes = new Set(policy.intent?.types ?? []);

  const delta = policy.rules?.delta_table ?? {};
  for (const [ev, row] of Object.entries(delta)) {
    if (!eventTypes.has(ev)) {
      issues.push({ file, path: `rules.delta_table.${ev}`, message: `unknown event type "${ev}"` });
    }
    for (const tr of Object.keys(row)) {
      if (!trackNames.has(tr)) {
        issues.push({ file, path: `rules.delta_table.${ev}.${tr}`, message: `unknown track "${tr}"` });
      }
    }
  }

  for (const [i, rule] of (policy.intent_rules ?? []).entries()) {
    if (!intentTypes.has(rule.intent)) {
      issues.push({ file, path: `intent_rules[${i}].intent`, message: `unknown intent "${rule.intent}"` });
    }
  }

  for (const [i, w] of (policy.rules?.windows ?? []).entries()) {
    for (const tr of Object.keys(w.mult)) {
      if (!trackNames.has(tr)) {
        issues.push({ file, path: `rules.windows[${i}].mult.${tr}`, message: `unknown track "${tr}"` });
      }
    }
  }

  for (const [i, c] of (policy.checks ?? []).entries()) {
    if (c.onSuccess?.setType && !eventTypes.has(c.onSuccess.setType)) {
      issues.push({ file, path: `checks[${i}].onSuccess.setType`, message: `unknown event type "${c.onSuccess.setType}"` });
    }
    if (c.onFailure?.setType && !eventTypes.has(c.onFailure.setType)) {
      issues.push({ file, path: `checks[${i}].onFailure.setType`, message: `unknown event type "${c.onFailure.setType}"` });
    }
  }

  for (const [cls, resp] of Object.entries(policy.input?.response ?? {})) {
    if (resp && typeof resp === "object" && "emit" in resp && resp.emit && !eventTypes.has(resp.emit)) {
      issues.push({ file, path: `input.response.${cls}.emit`, message: `unknown event type "${resp.emit}"` });
    }
    if (resp && typeof resp === "object" && "intent" in resp && resp.intent && !intentTypes.has(resp.intent)) {
      issues.push({ file, path: `input.response.${cls}.intent`, message: `unknown intent "${resp.intent}"` });
    }
    if (resp && typeof resp === "object" && "hook" in resp && typeof resp.hook === "string") {
      if (opts.knownRuleFns && !opts.knownRuleFns.has(resp.hook)) {
        issues.push({
          file,
          path: `input.response.${cls}.hook`,
          message: `unknown hook function "${resp.hook}"`,
          warn: true,
        });
      }
    }
  }

  for (const [i, cr] of (policy.rules?.custom ?? []).entries()) {
    if (opts.knownRuleFns) {
      if (!opts.knownRuleFns.has(cr.fn)) {
        issues.push({
          file,
          path: `rules.custom[${i}].fn`,
          message: `unknown rule function "${cr.fn}" (not registered)`,
          warn: true,
        });
      }
    } else {
      issues.push({
        file,
        path: `rules.custom[${i}].fn`,
        message: `rule function "${cr.fn}" cannot be validated without knownRuleFns`,
        warn: true,
      });
    }
  }
}

function maxGrantedLevel(grants: { maxLevel: Level }[]): Level {
  if (grants.length === 0) return "L0";
  let max = -1;
  let level: Level = "L0";
  for (const g of grants) {
    const r = levelRank(g.maxLevel);
    if (r > max) {
      max = r;
      level = g.maxLevel;
    }
  }
  return level;
}

function validateGrants(policy: Policy, file: string, issues: ValidationIssue[], authoredFields?: Record<string, Pick<FieldDef, "level">>): void {
  const grants = policy.fields?.grants ?? [];
  const maxLevel = maxGrantedLevel(grants);
  const maxRank = levelRank(maxLevel);
  for (const [fieldId, def] of Object.entries(authoredFields ?? {})) {
    if (levelRank(def.level) > maxRank) {
      issues.push({
        file,
        path: `fields.${fieldId}`,
        message: `declared field level ${def.level} exceeds policy grant max ${maxLevel}`,
      });
    }
  }
}

function validateVisibility(policy: Policy, file: string, issues: ValidationIssue[]): void {
  for (const [i, r] of (policy.visibility?.rules ?? []).entries()) {
    if (!r.viewer?.trim()) issues.push({ file, path: `visibility.rules[${i}].viewer`, message: "viewer must be non-empty" });
    if (!r.path?.trim()) issues.push({ file, path: `visibility.rules[${i}].path`, message: "path must be non-empty" });
  }
}

function validateCues(policy: Policy, file: string, issues: ValidationIssue[]): void {
  for (const [type, def] of Object.entries(policy.cues?.types ?? {})) {
    if (!type.trim()) issues.push({ file, path: "cues.types", message: "cue type id must be non-empty" });
    if (def.args && typeof def.args !== "object") {
      issues.push({ file, path: `cues.types.${type}.args`, message: "args must be a field descriptor record" });
    }
  }
}

function isNarrationStyle(style: string | undefined): boolean {
  return style === "narration" || style === "narration_break";
}

/** Every `{{ CEL }}` placeholder of a template must compile; a typo is a configuration error, not a runtime surprise. */
function checkTemplate(template: string | undefined, file: string, path: string, issues: ValidationIssue[]): void {
  if (!template) return;
  for (const expr of templateExpressions(template)) {
    const err = celCheck(expr);
    if (err) issues.push({ file, path, message: `template expression "${expr}": ${err}` });
  }
}

function checkRegex(source: string, flags: string, file: string, path: string, issues: ValidationIssue[]): void {
  try {
    new RegExp(source, flags);
  } catch (e) {
    issues.push({ file, path, message: `invalid regular expression: ${e instanceof Error ? e.message : String(e)}` });
  }
}

function validateLayers(
  layers: readonly RuleLayer[] | undefined,
  base: string,
  file: string,
  issues: ValidationIssue[],
  intentTypes: ReadonlySet<string>,
  cues: ReadonlySet<string>,
): void {
  const ids = new Set<string>();
  for (const [i, layer] of (layers ?? []).entries()) {
    const at = `${base}[${i}]`;
    if (ids.has(layer.id)) issues.push({ file, path: `${at}.id`, message: `duplicate layer id "${layer.id}"` });
    ids.add(layer.id);
    const narration = layer.pool.filter((e) => isNarrationStyle(e.style)).length;
    if (narration > 0 && narration < layer.pool.length) {
      issues.push({
        file,
        path: `${at}.pool`,
        message: "a layer is either an utterance layer or a narration layer: its pool mixes narration and utterance entries",
      });
    }
    for (const [j, entry] of layer.pool.entries()) {
      const where = `${at}.pool[${j}]`;
      checkTemplate(entry.text, file, `${where}.text`, issues);
      if (entry.intent && !intentTypes.has(entry.intent)) {
        issues.push({ file, path: `${where}.intent`, message: `unknown intent "${entry.intent}"` });
      }
      if (isNarrationStyle(entry.style) && (entry.cues.length > 0 || entry.intent)) {
        issues.push({ file, path: where, message: "a narration entry has no speaker: it cannot carry cues or an intent" });
      }
      for (const [c, cue] of entry.cues.entries()) {
        if (cues.size > 0 && !cues.has(cue.type)) {
          issues.push({ file, path: `${where}.cues[${c}].type`, message: `unknown cue type "${cue.type}"`, warn: true });
        }
      }
    }
  }
}

/**
 * Checks the keys the rule backend reads: every referenced event type, intent and cue type exists, every regular
 * expression compiles, every `{{ CEL }}` template placeholder type-checks, and narration pools stay separate from
 * utterance pools. The rule backend is a full backend, so it is held to the same standard as the authored policy.
 */
function validateRuleBackend(policy: Policy, file: string, issues: ValidationIssue[]): void {
  const eventTypes = new Set(Object.keys(policy.events?.types ?? {}));
  eventTypes.add("other");
  const intentTypes = new Set(policy.intent?.types ?? []);
  const cueTypes = new Set(Object.keys(policy.cues?.types ?? {}));
  const needType = (type: string, path: string) => {
    if (!eventTypes.has(type)) issues.push({ file, path, message: `unknown event type "${type}"` });
  };

  const appraise = policy.appraise;
  for (const [i, p] of (appraise?.patterns ?? []).entries()) {
    checkRegex(p.match, p.flags ?? "i", file, `appraise.patterns[${i}].match`, issues);
    needType(p.event.type, `appraise.patterns[${i}].event.type`);
  }
  if (appraise?.fallback) needType(appraise.fallback.type, "appraise.fallback.type");
  for (const [word, type] of Object.entries(appraise?.commands ?? {})) needType(type, `appraise.commands.${word}`);
  for (const [i, src] of (appraise?.inputClass?.injection ?? []).entries()) {
    checkRegex(src, "i", file, `appraise.inputClass.injection[${i}]`, issues);
  }
  for (const [i, src] of (appraise?.inputClass?.metaProbe ?? []).entries()) {
    checkRegex(src, "i", file, `appraise.inputClass.metaProbe[${i}]`, issues);
  }

  validateLayers(policy.render?.layers, "render.layers", file, issues, intentTypes, cueTypes);
  validateLayers(policy.scene?.autonomous?.rules, "scene.autonomous.rules", file, issues, intentTypes, cueTypes);
  for (const [i, layer] of (policy.scene?.autonomous?.rules ?? []).entries()) {
    if (layer.pool.some((e) => isNarrationStyle(e.style))) {
      issues.push({ file, path: `scene.autonomous.rules[${i}].pool`, message: "autonomous exchanges are spoken: a pool entry cannot be narration" });
    }
  }

  const fallback = policy.render?.fallback;
  if (fallback) {
    checkTemplate(fallback.text, file, "render.fallback.text", issues);
    if (fallback.intent && !intentTypes.has(fallback.intent)) {
      issues.push({ file, path: "render.fallback.intent", message: `unknown intent "${fallback.intent}"` });
    }
  }

  for (const [i, rule] of (policy.choices?.rules ?? []).entries()) {
    needType(rule.event_type, `choices.rules[${i}].event_type`);
    checkTemplate(rule.text, file, `choices.rules[${i}].text`, issues);
  }

  const writing = policy.memory?.writing;
  checkTemplate(writing?.template, file, "memory.writing.template", issues);
  for (const type of Object.keys(writing?.importanceByEventType ?? {})) {
    needType(type, `memory.writing.importanceByEventType.${type}`);
  }
  for (const type of Object.keys(writing?.valenceByEventType ?? {})) {
    needType(type, `memory.writing.valenceByEventType.${type}`);
  }
  checkTemplate(policy.reflection?.summaryTemplate, file, "reflection.summaryTemplate", issues);
  checkTemplate(policy.offscreen?.narrateTemplate, file, "offscreen.narrateTemplate", issues);
}

export function validatePolicyDocument(
  merged: unknown,
  opts: CrossValidateOptions = {},
): { policy?: ResolvedPolicy; issues: ValidationIssue[]; warnings: ValidationIssue[] } {
  const file = opts.file ?? "policy";
  const issues: ValidationIssue[] = [];

  const parsed = PolicySchema.safeParse(merged);
  if (!parsed.success) {
    for (const iss of parsed.error.issues) {
      issues.push({ file, path: iss.path.join(".") || "(root)", message: iss.message });
    }
    return { issues, warnings: [] };
  }

  const policy = parsed.data;
  validateTracks(policy, file, issues);
  validateRefs(policy, file, issues, opts);
  validateGrants(policy, file, issues, opts.authoredFields);
  validateVisibility(policy, file, issues);
  validateCues(policy, file, issues);
  validateRuleBackend(policy, file, issues);
  for (const cr of policy.rules?.custom ?? []) {
    if (cr.stage === "tick") {
      issues.push({
        file,
        path: `rules.custom.${cr.id}.stage`,
        message:
          'custom rule stage "tick" is not supported: use schedule item rules instead (policy custom rules run adjudicate, scene_start, scene_end, daily only)',
      });
    }
  }

  const errors = issues.filter((i) => !i.warn);
  const warnings = issues.filter((i) => i.warn);
  if (errors.length) return { issues: errors, warnings };
  return { policy: applyPolicyDefaults(policy), issues: [], warnings };
}
