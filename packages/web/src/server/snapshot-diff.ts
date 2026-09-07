export type PatchOp = { op: "replace" | "add" | "remove"; path: string; value?: unknown };

/** Shallow diff for incremental patch messages (falls back to full snapshot when too large). */
export function diffSnapshot(prev: Record<string, unknown>, next: Record<string, unknown>): PatchOp[] | null {
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  const ops: PatchOp[] = [];
  for (const k of keys) {
    if (JSON.stringify(prev[k]) === JSON.stringify(next[k])) continue;
    ops.push({ op: "replace", path: `/${k}`, value: next[k] });
  }
  if (ops.length === 0) return null;
  if (ops.length > 28) return null;
  return ops;
}
