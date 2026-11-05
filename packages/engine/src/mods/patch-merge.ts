function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function isAppendMarker(v: unknown): v is { $append: unknown[] | string } {
  return isPlainObject(v) && (Array.isArray(v.$append) || typeof v.$append === "string") && Object.keys(v).length === 1;
}

function isPrependMarker(v: unknown): v is { $prepend: unknown[] | string } {
  return isPlainObject(v) && (Array.isArray(v.$prepend) || typeof v.$prepend === "string") && Object.keys(v).length === 1;
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

/**
 * Deep-merge patch document into base (policy-style operators + $replace/$remove/$delete).
 *
 * A base that is itself an unresolved `$append` / `$prepend` marker is a policy document that has not met its earlier
 * layers yet (a locale patch over a game policy that extends a preset's array). The patch then **composes** with the
 * marker instead of flattening it into a plain array, so the policy merge still appends to the preset's array rather
 * than replacing it.
 */
export function applyPatchMerge(base: unknown, patch: unknown): unknown {
  if (patch === null || patch === undefined) return base;
  if (isAppendMarker(patch)) {
    if (isAppendMarker(base)) {
      if (typeof patch.$append === "string" && typeof base.$append === "string") return { $append: `${base.$append}${patch.$append}` };
      if (Array.isArray(patch.$append) && Array.isArray(base.$append)) return { $append: [...base.$append, ...patch.$append] };
    }
    if (typeof patch.$append === "string") return `${typeof base === "string" ? base : ""}${patch.$append}`;
    const arr = Array.isArray(base) ? base : [];
    return [...arr, ...patch.$append];
  }
  if (isPrependMarker(patch)) {
    if (isPrependMarker(base)) {
      if (typeof patch.$prepend === "string" && typeof base.$prepend === "string") return { $prepend: `${patch.$prepend}${base.$prepend}` };
      if (Array.isArray(patch.$prepend) && Array.isArray(base.$prepend)) return { $prepend: [...patch.$prepend, ...base.$prepend] };
    }
    if (typeof patch.$prepend === "string") return `${patch.$prepend}${typeof base === "string" ? base : ""}`;
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
