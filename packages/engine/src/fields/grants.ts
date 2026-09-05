import type { CelEngine } from "../contracts.ts";
import type { FieldDef } from "../schema/authored.ts";
import type { ResolvedPolicy } from "../schema/policy.ts";
import { levelIndex } from "./levels.ts";

export function grantAllowed(
  def: FieldDef,
  source: string,
  policy: ResolvedPolicy,
  cel: CelEngine,
): boolean {
  const grants = policy.fields?.grants ?? [];
  if (grants.length === 0) return def.source === "author";
  const holder = def.holder;
  const ctx = {
    holder: { kind: holder.kind, ref: holder.ref ?? null },
    source,
  };
  for (const g of grants) {
    if (!cel.bool(g.holder, ctx)) continue;
    if (!cel.bool(g.source, ctx)) continue;
    if (levelIndex(def.level) <= levelIndex(g.maxLevel)) return true;
  }
  return false;
}
