import type { FieldEffects } from "../schema/authored.ts";

export function clampEffects(effects: FieldEffects, caps: Record<string, number> | undefined, bypass: boolean): { effects: FieldEffects; clamped: string[] } {
  if (bypass || !caps || Object.keys(caps).length === 0) return { effects, clamped: [] };
  const clamped: string[] = [];
  const out = structuredClone(effects) as Record<string, unknown>;

  const cap = (path: string, value: number): number => {
    const limit = caps[path];
    if (limit === undefined) return value;
    const abs = Math.abs(value);
    if (abs <= limit) return value;
    clamped.push(path);
    return Math.sign(value) * limit;
  };

  if (out.event_prob && isRec(out.event_prob)) {
    for (const [k, v] of Object.entries(out.event_prob)) {
      if (typeof v === "number") out.event_prob[k] = cap("event_prob", v);
    }
  }
  if (Array.isArray(out.salience)) {
    for (const entry of out.salience as { tags: string[]; boost: number }[]) {
      if (typeof entry.boost === "number") entry.boost = cap("salience.boost", entry.boost);
    }
  }
  if (out.track_offset && isRec(out.track_offset)) {
    for (const [k, v] of Object.entries(out.track_offset)) {
      if (typeof v === "number") out.track_offset[k] = cap("track_offset", v);
    }
  }
  if (out.track_mult && isRec(out.track_mult)) {
    for (const [track, inner] of Object.entries(out.track_mult)) {
      if (!isRec(inner)) continue;
      for (const [k, v] of Object.entries(inner)) {
        if (typeof v === "number") inner[k] = cap("track_mult", v);
      }
      out.track_mult[track] = inner;
    }
  }
  if (out.intent_bias && isRec(out.intent_bias)) {
    for (const [k, v] of Object.entries(out.intent_bias)) {
      if (typeof v === "number") out.intent_bias[k] = cap("intent_bias", v);
    }
  }

  return { effects: out as FieldEffects, clamped: [...new Set(clamped)] };
}

function isRec(v: unknown): v is Record<string, number> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
