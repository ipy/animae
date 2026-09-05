import type { ConfigWarning } from "../contracts.ts";
import type { Policy } from "../schema/policy.ts";

export type PolicyLayer = { name: string; doc: unknown };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function isAppendMarker(v: unknown): v is { $append: unknown[] } {
  return isPlainObject(v) && Array.isArray(v.$append) && Object.keys(v).length === 1;
}

function isPrependMarker(v: unknown): v is { $prepend: unknown[] } {
  return isPlainObject(v) && Array.isArray(v.$prepend) && Object.keys(v).length === 1;
}

function pathJoin(base: string, key: string): string {
  return base ? `${base}.${key}` : key;
}

function leafOverrideWarning(file: string, path: string, prev: unknown, next: unknown): ConfigWarning {
  return {
    code: "POLICY_OVERRIDE",
    message: `policy value overridden at ${path}`,
    file,
    path,
  };
}

function valuesDiffer(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return false;
  if (typeof a === "object" && typeof b === "object" && a !== null && b !== null) {
    try {
      return JSON.stringify(a) !== JSON.stringify(b);
    } catch {
      return true;
    }
  }
  return true;
}

function mergeValue(
  file: string,
  path: string,
  base: unknown,
  incoming: unknown,
  warnings: ConfigWarning[],
): unknown {
  if (isAppendMarker(incoming)) {
    const arr = Array.isArray(base) ? base : [];
    return [...arr, ...incoming.$append];
  }
  if (isPrependMarker(incoming)) {
    const arr = Array.isArray(base) ? base : [];
    return [...incoming.$prepend, ...arr];
  }
  if (Array.isArray(incoming)) {
    if (base !== undefined && Array.isArray(base) && valuesDiffer(base, incoming)) {
      warnings.push(leafOverrideWarning(file, path, base, incoming));
    } else if (base !== undefined && !Array.isArray(base)) {
      warnings.push(leafOverrideWarning(file, path, base, incoming));
    }
    return incoming;
  }
  if (isPlainObject(incoming)) {
    const prev = isPlainObject(base) ? base : {};
    return mergeRecords(file, path, prev, incoming, warnings);
  }
  // scalar leaf
  if (base !== undefined && valuesDiffer(base, incoming)) {
    warnings.push(leafOverrideWarning(file, path, base, incoming));
  }
  return incoming;
}

function mergeRecords(
  file: string,
  path: string,
  base: Record<string, unknown>,
  incoming: Record<string, unknown>,
  warnings: ConfigWarning[],
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const key of Object.keys(incoming)) {
    const childPath = pathJoin(path, key);
    out[key] = mergeValue(file, childPath, base[key], incoming[key], warnings);
  }
  return out;
}

/** Deep-merge policy documents; later layers override earlier ones (§7.4). */
export function mergePolicies(layers: PolicyLayer[]): { merged: Policy; warnings: ConfigWarning[] } {
  const warnings: ConfigWarning[] = [];
  let merged: Record<string, unknown> = {};
  for (const layer of layers) {
    if (layer.doc === null || layer.doc === undefined) continue;
    if (!isPlainObject(layer.doc)) {
      warnings.push({
        code: "POLICY_OVERRIDE",
        message: "policy layer is not an object; skipped",
        file: layer.name,
      });
      continue;
    }
    merged = mergeRecords(layer.name, "", merged, layer.doc, warnings) as Record<string, unknown>;
  }
  return { merged: merged as Policy, warnings };
}
