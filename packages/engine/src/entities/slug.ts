import { AnimaeError } from "../types.ts";

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/;

export function slugId(name: string): string {
  let s = name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_.:-]+/g, "")
    .replace(/^-+/, "");
  if (!s) s = "entity";
  if (!ID_RE.test(s)) {
    s = s.replace(/^[^A-Za-z0-9]+/, "x");
  }
  if (!ID_RE.test(s)) throw new AnimaeError("ENTITY_INVALID", `cannot derive id from name "${name}"`);
  return s;
}

export function uniqueId(base: string, exists: (id: string) => boolean): string {
  if (!exists(base)) return base;
  for (let n = 2; n < 10_000; n++) {
    const cand = `${base}-${n}`;
    if (ID_RE.test(cand) && !exists(cand)) return cand;
  }
  throw new AnimaeError("ENTITY_DUPLICATE", `no unique id for "${base}"`);
}
