import { expect, test } from "bun:test";
import { generatedBundle } from "../src/generated.ts";

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

test("preset-base bundle has no display $t keys without displayStrings tables", () => {
  const keys = new Set<string>();
  for (const p of generatedBundle.policies) collectI18nKeys(p.doc, keys);
  expect(keys.size).toBe(0);
  expect(generatedBundle.displayStrings).toBeUndefined();
});
