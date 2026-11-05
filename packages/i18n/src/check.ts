import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { extractPlaceholders, flattenCatalog, placeholderSetsMatch } from "./format-message.ts";
import { normalizeLocaleTag } from "./negotiate.ts";
import { findCjkStringLiterals } from "./cjk-scan.ts";
import type { I18nCheckOptions, I18nCheckResult, MessageCatalog } from "./types.ts";

const SKIP_DIRS = new Set(["node_modules", "dist", ".git"]);
const T_CALL =
  /\b(?:i18n\.)?t(?:Pseudo)?\(\s*["'`]([^"'`]+)["'`]/g;

async function walkFiles(root: string, out: string[] = []): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    if (SKIP_DIRS.has(ent.name)) continue;
    const p = join(root, ent.name);
    if (ent.isDirectory()) await walkFiles(p, out);
    else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(ent.name)) out.push(p);
  }
  return out;
}

function catalogKeys(catalogs: Record<string, Record<string, MessageCatalog>>, locale: string): Map<string, Set<string>> {
  const loc = normalizeLocaleTag(locale);
  const byNs = new Map<string, Set<string>>();
  for (const [ns, byLoc] of Object.entries(catalogs)) {
    const cat = byLoc[loc] ?? byLoc[locale];
    if (!cat) continue;
    byNs.set(ns, new Set(Object.keys(flattenCatalog(cat))));
  }
  return byNs;
}

export async function runI18nCheck(
  opts: I18nCheckOptions & { scanCjk?: boolean },
): Promise<I18nCheckResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const ref = normalizeLocaleTag(opts.referenceLocale);
  const refKeys = catalogKeys(opts.catalogs, ref);
  const coverage: I18nCheckResult["coverage"] = {};

  for (const locRaw of opts.locales) {
    const loc = normalizeLocaleTag(locRaw);
    if (loc === ref) continue;
    const keys = catalogKeys(opts.catalogs, loc);
    const missing: string[] = [];
    let total = 0;
    for (const [ns, refSet] of refKeys) {
      const locSet = keys.get(ns) ?? new Set();
      for (const k of refSet) {
        total++;
        if (!locSet.has(k)) missing.push(`${ns}:${k}`);
        else {
          const refMsg = flattenCatalog(opts.catalogs[ns]![ref]!)[k]!;
          const locMsg = flattenCatalog(opts.catalogs[ns]![loc]!)[k]!;
          if (!placeholderSetsMatch(refMsg, locMsg)) {
            errors.push(`placeholder mismatch ${loc} ${ns}:${k} — ref {${extractPlaceholders(refMsg).join(",")}} vs {${extractPlaceholders(locMsg).join(",")}}`);
          }
        }
      }
      for (const extra of locSet) {
        if (!refSet.has(extra)) warnings.push(`extra key in ${loc} ${ns}:${extra}`);
      }
    }
    coverage[loc] = { total, missing };
    if (missing.length) errors.push(`locale ${loc} missing ${missing.length} keys (e.g. ${missing.slice(0, 5).join(", ")})`);
  }

  const usedKeys = new Set<string>();
  let scanned = 0;
  for (const root of opts.scanRoots ?? []) {
    for (const file of await walkFiles(root)) {
      if (file.includes("/locales/") || file.includes("/prompts/")) continue;
      scanned += 1;
      const text = await readFile(file, "utf8");
      if (opts.scanCjk !== false) {
        for (const hit of findCjkStringLiterals(text, file)) {
          errors.push(`CJK string literal ${relative(root, file)}:${hit.line} ${hit.excerpt}`);
        }
      }
      let m: RegExpExecArray | null;
      T_CALL.lastIndex = 0;
      while ((m = T_CALL.exec(text))) {
        usedKeys.add(m[1]!);
      }
    }
  }

  const declared = new Set<string>();
  for (const [ns, set] of refKeys) {
    for (const k of set) declared.add(`${ns}:${k}`);
  }
  const unusedKeys: string[] = [];
  for (const d of declared) {
    const plain = d.includes(":") ? d.split(":").slice(1).join(":") : d;
    if (!usedKeys.has(plain) && !usedKeys.has(d)) unusedKeys.push(d);
  }
  // Without sources to scan (a compiled binary has none) "not referenced" would only be noise.
  if (scanned > 0 && unusedKeys.length > 20) {
    warnings.push(`${unusedKeys.length} catalog keys not referenced by static t() scan (first: ${unusedKeys.slice(0, 3).join(", ")})`);
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    coverage,
    unusedKeys,
  };
}

export async function scanSourceRoots(roots: readonly string[]): Promise<{ file: string; keys: string[] }[]> {
  const out: { file: string; keys: string[] }[] = [];
  for (const root of roots) {
    for (const file of await walkFiles(root)) {
      const text = await readFile(file, "utf8");
      const keys: string[] = [];
      let m: RegExpExecArray | null;
      T_CALL.lastIndex = 0;
      while ((m = T_CALL.exec(text))) keys.push(m[1]!);
      if (keys.length) out.push({ file: relative(root, file), keys });
    }
  }
  return out;
}
