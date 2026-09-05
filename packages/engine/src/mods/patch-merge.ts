function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function isAppendMarker(v: unknown): v is { $append: unknown[] } {
  return isPlainObject(v) && Array.isArray(v.$append) && Object.keys(v).length === 1;
}

function isPrependMarker(v: unknown): v is { $prepend: unknown[] } {
  return isPlainObject(v) && Array.isArray(v.$prepend) && Object.keys(v).length === 1;
}

function isReplaceMarker(v: unknown): v is { $replace: unknown[] } {
  return isPlainObject(v) && Array.isArray(v.$replace) && Object.keys(v).length === 1;
}

function isRemoveMarker(v: unknown): v is { $remove: unknown[] | { id: string }[] } {
  return isPlainObject(v) && "$remove" in v && Object.keys(v).length === 1;
}

function itemId(v: unknown): string | undefined {
  if (isPlainObject(v) && typeof v.id === "string") return v.id;
  return undefined;
}

function applyRemove(base: unknown[], incoming: unknown[]): unknown[] {
  const out = [...base];
  for (const rem of incoming) {
    const rid = itemId(rem);
    if (rid !== undefined) {
      for (let i = out.length - 1; i >= 0; i--) {
        if (itemId(out[i]) === rid) out.splice(i, 1);
      }
      continue;
    }
    for (let i = out.length - 1; i >= 0; i--) {
      if (JSON.stringify(out[i]) === JSON.stringify(rem)) out.splice(i, 1);
    }
  }
  return out;
}

/** Deep-merge patch document into base (policy-style operators + $replace/$remove/$delete). */
export function applyPatchMerge(base: unknown, patch: unknown): unknown {
  if (patch === null || patch === undefined) return base;
  if (isAppendMarker(patch)) {
    const arr = Array.isArray(base) ? base : [];
    return [...arr, ...patch.$append];
  }
  if (isPrependMarker(patch)) {
    const arr = Array.isArray(base) ? base : [];
    return [...patch.$prepend, ...arr];
  }
  if (isReplaceMarker(patch)) {
    return [...patch.$replace];
  }
  if (isRemoveMarker(patch)) {
    const arr = Array.isArray(base) ? base : [];
    return applyRemove(arr, patch.$remove as unknown[]);
  }
  if (Array.isArray(patch)) return patch;
  if (isPlainObject(patch)) {
    const prev = isPlainObject(base) ? base : {};
    const out: Record<string, unknown> = { ...prev };
    for (const key of Object.keys(patch)) {
      const inc = patch[key];
      if (inc === null) {
        delete out[key];
        continue;
      }
      if (isPlainObject(inc) && inc.$delete === true && Object.keys(inc).length === 1) {
        delete out[key];
        continue;
      }
      out[key] = applyPatchMerge(prev[key], inc);
    }
    return out;
  }
  return patch;
}
