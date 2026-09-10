import { parseYaml } from "../store/util.ts";
import type { StoragePort } from "../ports.ts";

const T_REF = /^\$t:([a-zA-Z0-9_.-]+)$/;
const T_MUSTACHE = /\{\{\s*t\.([a-zA-Z0-9_.-]+)\s*\}\}/g;

export interface StringTableResolver {
  resolve(key: string): string | undefined;
  warnings: string[];
}

export async function loadStringTables(
  storage: StoragePort,
  localeChain: readonly string[],
): Promise<StringTableResolver> {
  const tables: Record<string, string>[] = [];
  const warnings: string[] = [];

  for (const locale of localeChain) {
    for (const path of [`locales/${locale}/strings.yaml`, `locales/${locale}/strings.json`]) {
      const text = await storage.readText(path);
      if (!text) continue;
      try {
        const raw = path.endsWith(".json") ? JSON.parse(text) : parseYaml(text);
        tables.push(flattenStringTable(raw as Record<string, unknown>));
      } catch {
        warnings.push(`invalid string table ${path}`);
      }
    }
    const files = await storage.listFiles(`locales/${locale}`);
    for (const path of files) {
      if (!path.endsWith(".strings.yaml")) continue;
      const text = await storage.readText(path);
      if (!text) continue;
      tables.push(flattenStringTable(parseYaml(text) as Record<string, unknown>));
    }
  }

  return {
    warnings,
    resolve(key: string) {
      for (const table of tables) {
        if (table[key] !== undefined) return table[key];
      }
      return undefined;
    },
  };
}

function flattenStringTable(obj: Record<string, unknown>, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out[key] = v;
    else if (v && typeof v === "object" && !Array.isArray(v)) Object.assign(out, flattenStringTable(v as Record<string, unknown>, key));
  }
  return out;
}

/** Lift `$t:key` to `{ i18n: { key } }` for late UI binding (does not read string tables). */
export function liftStringRefs(value: unknown, path = ""): unknown {
  if (typeof value === "string") {
    const m = T_REF.exec(value.trim());
    if (m) return { i18n: { key: m[1]! } };
    return value;
  }
  if (Array.isArray(value)) return value.map((v, i) => liftStringRefs(v, `${path}[${i}]`));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = liftStringRefs(v, path ? `${path}.${k}` : k);
    return out;
  }
  return value;
}

/** Eager resolve for validate / tooling (uses `uiLocale` or `contentLocale` string tables). */
export function resolveStringRefs(value: unknown, resolver: StringTableResolver, path = ""): unknown {
  if (typeof value === "string") {
    const m = T_REF.exec(value.trim());
    if (m) {
      const hit = resolver.resolve(m[1]!);
      if (hit === undefined) {
        resolver.warnings.push(`missing translation ${m[1]!}${path ? ` at ${path}` : ""}`);
        return value;
      }
      return hit;
    }
    return value.replace(T_MUSTACHE, (_, key: string) => resolver.resolve(key) ?? `{{ t.${key} }}`);
  }
  if (Array.isArray(value)) return value.map((v, i) => resolveStringRefs(v, resolver, `${path}[${i}]`));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = resolveStringRefs(v, resolver, path ? `${path}.${k}` : k);
    return out;
  }
  return value;
}
