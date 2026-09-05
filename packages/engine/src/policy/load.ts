import type { ConfigWarning, PolicyLoadResult, PresetRegistry } from "../contracts.ts";
import type { StoragePort } from "../ports.ts";
import type { AnimaeConfig } from "../schema/authored.ts";
import { setCelValidator } from "../schema/common.ts";
import { celCheck } from "../rules/cel.ts";
import { sha256Hex, stableStringify } from "../store/util.ts";
import { AnimaeError } from "../types.ts";
import { applyPolicyDefaults } from "./defaults.ts";
import { loadPolicyDocFromPath } from "./load-policy-doc.ts";
import { mergePolicies } from "./merge.ts";
import { resolvePresetChain } from "./registry.ts";
import type { CrossValidateOptions } from "./validate.ts";
import { validatePolicyDocument } from "./validate.ts";

export type LoadPolicyOptions = CrossValidateOptions;

function formatIssues(issues: { file: string; path: string; message: string }[]): string {
  return issues.map((i) => `${i.file}:${i.path}: ${i.message}`).join("\n");
}

export async function loadPolicy(
  storage: StoragePort,
  config: AnimaeConfig,
  registry: PresetRegistry,
  opts: LoadPolicyOptions = {},
): Promise<PolicyLoadResult> {
  setCelValidator(celCheck);

  const layers: { name: string; doc: unknown }[] = [];
  const presets = config.preset ? resolvePresetChain(registry, config.preset) : [];

  for (const bundle of presets) {
    for (const p of bundle.policies) layers.push(p);
  }

  for (const rel of config.policies) {
    layers.push(await loadPolicyDocFromPath(storage, rel));
  }

  const { merged, warnings: mergeWarnings } = mergePolicies(layers);

  const { policy, issues, warnings: valWarnings } = validatePolicyDocument(merged, {
    file: "policy",
    knownRuleFns: opts.knownRuleFns,
    authoredFields: opts.authoredFields,
  });

  const configWarnings: ConfigWarning[] = [
    ...mergeWarnings,
    ...valWarnings.map((w) => ({
      code: "POLICY_WARN",
      message: w.message,
      file: w.file,
      path: w.path,
    })),
  ];

  if (issues.length) {
    throw new AnimaeError("CONFIG_INVALID", formatIssues(issues));
  }

  const resolved = policy ?? applyPolicyDefaults(merged as import("../schema/policy.ts").Policy);
  const hash = sha256Hex(stableStringify(resolved));

  return { policy: resolved, warnings: configWarnings, presets, hash };
}
