import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { generatedBundle } from "../src/generated.ts";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function flattenStrings(obj: Record<string, unknown>, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out[key] = v;
    else if (v && typeof v === "object" && !Array.isArray(v)) {
      Object.assign(out, flattenStrings(v as Record<string, unknown>, key));
    }
  }
  return out;
}

function collectI18nKeys(value: unknown, out: Set<string>): void {
  if (value == null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const v of value) collectI18nKeys(v, out);
    return;
  }
  const o = value as Record<string, unknown>;
  if (o.i18n && typeof o.i18n === "object" && typeof (o.i18n as { key?: unknown }).key === "string") {
    out.add((o.i18n as { key: string }).key);
  }
  for (const v of Object.values(o)) collectI18nKeys(v, out);
}

test("every $t key in bundled policies exists in en and fr displayStrings", () => {
  const keys = new Set<string>();
  for (const p of generatedBundle.policies) collectI18nKeys(p.doc, keys);
  const tables = generatedBundle.displayStrings!;
  for (const key of keys) {
    expect(tables.en?.[key], `missing en string for ${key}`).toBeTruthy();
    expect(tables.fr?.[key], `missing fr string for ${key}`).toBeTruthy();
  }
});

test("locale YAML matches generated displayStrings", () => {
  for (const locale of ["en", "fr"] as const) {
    const yaml = flattenStrings(
      parseYaml(readFileSync(join(pkgRoot, "locales", locale, "strings.yaml"), "utf8")) as Record<string, unknown>,
    );
    expect(yaml).toEqual(generatedBundle.displayStrings![locale]!);
  }
});
