import type { Kernel } from "../contracts.ts";
import type { CharacterId } from "../types.ts";
import { memorySyncList } from "../memory/service.ts";

/** Same subject+predicate, different object → contradiction (§17). */
export function detectContradiction(
  k: Kernel,
  owner: CharacterId,
  claims: { s: string; p: string; o: string }[],
): boolean {
  if (!claims.length) return false;
  const norm = (s: string) => s.trim().toLowerCase();
  const existing: { s: string; p: string; o: string }[] = [];
  const st = k.timeline.state().characters[owner];
  if (st) existing.push(...st.claims.map((c) => ({ s: c.s, p: c.p, o: c.o })));
  for (const m of memorySyncList(k, owner)) {
    existing.push(...m.claims);
  }
  for (const c of claims) {
    const s = norm(c.s);
    const p = norm(c.p);
    const o = norm(c.o);
    for (const e of existing) {
      if (norm(e.s) === s && norm(e.p) === p && norm(e.o) !== o) return true;
    }
  }
  return false;
}
