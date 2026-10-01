import type { Level } from "../schema/common.ts";
import type { FieldDef } from "../schema/authored.ts";
import type { Policy, ResolvedPolicy } from "../schema/policy.ts";
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
