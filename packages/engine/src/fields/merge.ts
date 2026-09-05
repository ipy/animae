import type { Kernel } from "../contracts.ts";
import type { FieldDef, FieldEffects } from "../schema/authored.ts";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function unionArrays(a: unknown[], b: unknown[]): unknown[] {
  const out = [...a];
  for (const x of b) if (!out.some((y) => stableEq(y, x))) out.push(x);
  return out;
}

function stableEq(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function mergeAdd(a: unknown, b: unknown): unknown {
  if (typeof a === "number" && typeof b === "number") return a + b;
  if (Array.isArray(a) && Array.isArray(b)) return unionArrays(a, b);
  if (isPlainObject(a) && isPlainObject(b)) {
    const out: Record<string, unknown> = { ...a };
    for (const [k, v] of Object.entries(b)) {
      out[k] = k in out ? mergeAdd(out[k], v) : v;
    }
    return out;
  }
  return b;
}

function mergeMax(a: unknown, b: unknown): unknown {
  if (typeof a === "number" && typeof b === "number") return Math.max(a, b);
  if (Array.isArray(a) && Array.isArray(b)) return unionArrays(a, b);
  if (isPlainObject(a) && isPlainObject(b)) {
    const out: Record<string, unknown> = { ...a };
    for (const [k, v] of Object.entries(b)) {
      out[k] = k in out ? mergeMax(out[k], v) : v;
    }
    return out;
  }
  return a;
}

function runResolver(name: string, values: unknown[], k: Kernel, celCtx: Record<string, unknown>): unknown {
  const fn = k.rules.fn(name);
  if (!fn) return values[0];
  const drafts = k.rules.run(name, {
    stage: "applyFields",
    state: k.timeline.state(),
    authored: k.authored,
    policy: k.policy,
    time: k.timeline.now(),
    vars: { ...celCtx, field_merge_values: values },
    rngKey: `field_resolver:${name}`,
  });
  const hit = drafts.find((d) => d.kind === "field.resolver") as { merged?: unknown } | undefined;
  if (hit && "merged" in hit) return hit.merged;
  return values[0];
}

function combine(stacking: string, prev: unknown, next: unknown, k: Kernel, celCtx: Record<string, unknown>): unknown {
  if (prev === undefined) return next;
  if (stacking === "override") return prev;
  if (stacking.startsWith("resolver:")) {
    const fnName = stacking.slice("resolver:".length);
    if (isPlainObject(prev) && isPlainObject(next)) {
      const out: Record<string, unknown> = { ...prev };
      for (const [subKey, v] of Object.entries(next)) {
        out[subKey] = subKey in out ? runResolver(fnName, [out[subKey], v], k, celCtx) : v;
      }
      return out;
    }
    return runResolver(fnName, [prev, next], k, celCtx);
  }
  if (stacking === "max") return mergeMax(prev, next);
  return mergeAdd(prev, next);
}

/** Merge effect maps for one level: fields must already be sorted by priority (desc). */
export function mergeFieldEffects(
  fields: FieldDef[],
  k: Kernel,
  celCtx: Record<string, unknown>,
): FieldEffects {
  const out: FieldEffects = {};
  for (const f of fields) {
    for (const [key, val] of Object.entries(f.effects)) {
      if (val === undefined) continue;
      const prev = (out as Record<string, unknown>)[key];
      (out as Record<string, unknown>)[key] = combine(f.stacking, prev, val, k, celCtx);
    }
  }
  return out;
}
