import type { FieldDescriptor, Template } from "../schema/authored.ts";
import { descriptorToZod } from "../entities/descriptor.ts";
import type { RuleEnv } from "./env.ts";
import { uniformPick } from "./rng.ts";

/** What the entity purpose passes in `ModelCallContext.extra`. */
export interface EntityCallExtra {
  template: Template;
  templateId: string;
  hints?: Record<string, unknown>;
  /** The character as it is now, when this is a promotion: existing values are kept, only missing fields are filled. */
  current?: Record<string, unknown>;
}

function between(min: number | undefined, max: number | undefined, integer: boolean, rng: () => number): number {
  if (min === undefined && max === undefined) return 0;
  if (max === undefined) return min!;
  if (min === undefined) return max;
  const v = min + rng() * (max - min);
  return integer ? Math.min(max, Math.max(min, Math.round(v))) : Math.round(v * 100) / 100;
}

/** A value that satisfies `desc` when nothing else supplied one. */
function synthesize(desc: FieldDescriptor, label: string, rng: () => number): unknown {
  switch (desc.type) {
    case "string":
      if (desc.enum?.length) return String(uniformPick(desc.enum, rng));
      return `${label} ${100 + Math.floor(rng() * 900)}`;
    case "number":
    case "integer":
      if (desc.enum?.length) return Number(uniformPick(desc.enum, rng));
      return between(desc.min, desc.max, desc.type === "integer", rng);
    case "boolean":
      return false;
    case "array":
      return [];
    case "object": {
      const out: Record<string, unknown> = {};
      for (const [name, sub] of Object.entries(desc.fields)) {
        if (sub.optional) continue;
        out[name] = synthesize(sub, name, rng);
      }
      return out;
    }
  }
}

function usable(desc: FieldDescriptor, value: unknown): boolean {
  return descriptorToZod(desc).safeParse(value).success;
}

/**
 * Entity generation without a model. Per field: the current value (promotion), a hint, the template's `defaults`
 * (a list is a pool the seeded rng picks from, unless the field itself is a list), the descriptor's `default`, and last
 * a value synthesized from the descriptor. Optional fields with no source are left out.
 */
export function ruleEntity(env: RuleEnv): Record<string, unknown> {
  const extra = env.ctx.extra as unknown as EntityCallExtra;
  const { template, templateId, hints, current } = extra;
  const out: Record<string, unknown> = {};
  for (const [name, desc] of Object.entries(template.fields)) {
    const candidates: unknown[] = [];
    if (current && name in current) candidates.push(current[name]);
    if (hints && name in hints) candidates.push(hints[name]);
    const fromDefaults = template.defaults[name];
    if (fromDefaults !== undefined) {
      candidates.push(Array.isArray(fromDefaults) && desc.type !== "array" && fromDefaults.length > 0 ? uniformPick(fromDefaults, env.rng) : fromDefaults);
    }
    if ("default" in desc && desc.default !== undefined) candidates.push(desc.default);
    const hit = candidates.find((c) => usable(desc, c));
    if (hit !== undefined) {
      out[name] = hit;
      continue;
    }
    if (desc.optional) continue;
    out[name] = synthesize(desc, templateId, env.rng);
  }
  return out;
}
