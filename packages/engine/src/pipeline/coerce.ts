import type { ResolvedPolicy } from "../schema/policy.ts";

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v == null || typeof v !== "object" || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

function normalizeIntensity(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  /** Treat 10–100 as percent-style 0–100; small values >1 clamp on 0–1 scale. */
  if (n >= 10 && n <= 100) return n / 100;
  if (n > 1) return 1;
  return n;
}

function normalizeUnit(v: unknown): number {
  const n = normalizeIntensity(v);
  return Math.min(1, Math.max(0, n));
}

function normalizeString(v: unknown): string {
  return typeof v === "string" ? v.trim() : String(v ?? "");
}

function normalizeLower(v: unknown): string {
  return normalizeString(v).toLowerCase();
}

/** Strip markdown ```json fences if a provider returned a string body (repair path helper). */
export function parseJsonLoose(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)```\s*$/i.exec(trimmed);
  const body = fenced ? fenced[1]!.trim() : trimmed;
  return JSON.parse(body) as unknown;
}

export function coerceAppraiseRaw(raw: Record<string, unknown>, policy: ResolvedPolicy): Record<string, unknown> {
  const types = policy.events.types;
  const approaches = (policy.x?.approaches as string[] | undefined) ?? [];
  let type = normalizeLower(raw.type);
  if (type && !(type in types)) {
    const hit = Object.keys(types).find((k) => k.toLowerCase() === type);
    type = hit ?? type;
  }
  if (type && !(type in types)) type = "other";

  let input_class = normalizeLower(raw.input_class);
  if (!["normal", "injection_suspect", "meta_probe"].includes(input_class)) input_class = "normal";

  let approach: string | undefined;
  if (raw.approach != null && String(raw.approach).length) {
    let a = normalizeLower(raw.approach);
    if (approaches.length) {
      const hit = approaches.find((x) => x.toLowerCase() === a);
      a = hit ?? a;
    }
    approach = a;
  }

  let safety = raw.safety != null ? normalizeLower(raw.safety) : undefined;
  if (policy.safety.enabled && safety && !["none", "self_harm", "real_world_danger", "sexual_minors", "personal_crisis"].includes(safety)) {
    safety = "none";
  }

  const claims = Array.isArray(raw.claims)
    ? (raw.claims as unknown[]).map((c) => asRecord(c)).filter(Boolean)
    : [];
  const search_terms = Array.isArray(raw.search_terms) ? raw.search_terms.map((s) => normalizeString(s)).filter(Boolean) : [];
  const tags = Array.isArray(raw.tags) ? raw.tags.map((t) => normalizeLower(t)).filter(Boolean) : [];

  return {
    type: type || "other",
    intensity: normalizeUnit(raw.intensity),
    sincerity: normalizeUnit(raw.sincerity),
    approach,
    claims: claims.map((c) => ({ s: normalizeString(c!.s), p: normalizeString(c!.p), o: normalizeString(c!.o) })).filter((c) => c.s && c.p && c.o),
    search_terms,
    tags,
    input_class,
    ...(policy.safety.enabled ? { safety: safety ?? "none" } : {}),
  };
}

export function coerceRenderRaw(raw: Record<string, unknown>): Record<string, unknown> {
  const text = typeof raw.text === "string" ? raw.text : normalizeString(raw.text);
  const intent_realized = normalizeString(raw.intent_realized);
  const cues = Array.isArray(raw.cues)
    ? (raw.cues as unknown[]).map((c) => {
        const row = asRecord(c);
        if (!row) return null;
        const type = normalizeString(row.type);
        const args = asRecord(row.args) ?? {};
        const at = row.at != null ? Number(row.at) : undefined;
        return { type, args, ...(Number.isFinite(at) ? { at: Math.max(0, Math.floor(at!)) } : {}) };
      }).filter(Boolean)
    : [];
  const choices = Array.isArray(raw.choices)
    ? (raw.choices as unknown[]).map((c) => {
        const row = asRecord(c);
        if (!row) return null;
        return {
          text: normalizeString(row.text),
          expected_event_type: normalizeLower(row.expected_event_type),
          tags: Array.isArray(row.tags) ? row.tags.map((t) => normalizeLower(t)) : [],
        };
      }).filter(Boolean)
    : undefined;

  return { text, intent_realized, cues, ...(choices ? { choices } : {}) };
}
