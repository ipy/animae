import { expect, test } from "bun:test";
import { celCheck } from "../../engine/src/rules/cel.ts";
import { templateExpressions } from "../../engine/src/rule-backend/template.ts";
import { generatedBundle } from "../src/generated.ts";

const T_REF = /^\$t:([a-zA-Z0-9_.-]+)$/;

/** Every `$t:key` string value of the bundle's policies, with the path it sits at. */
function collectStringRefs(value: unknown, path: string, out: Map<string, string>): void {
  if (typeof value === "string") {
    const m = T_REF.exec(value.trim());
    if (m) out.set(m[1]!, path);
    return;
  }
  if (value == null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((v, i) => collectStringRefs(v, `${path}[${i}]`, out));
    return;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) collectStringRefs(v, path ? `${path}.${k}` : k, out);
}

function referencedKeys(): Map<string, string> {
  const keys = new Map<string, string>();
  for (const p of generatedBundle.policies) collectStringRefs(p.doc, p.name, keys);
  return keys;
}

test("every string-table key a policy references exists in the English table", () => {
  const en = generatedBundle.displayStrings?.en;
  expect(en).toBeDefined();
  const missing = [...referencedKeys()].filter(([key]) => en![key] === undefined).map(([key, at]) => `${key} (${at})`);
  expect(missing).toEqual([]);
});

test("every key of the English table is used by a policy", () => {
  const used = new Set(referencedKeys().keys());
  const unused = Object.keys(generatedBundle.displayStrings?.en ?? {}).filter((key) => !used.has(key));
  expect(unused).toEqual([]);
});

test("string-table keys are namespaced by the preset", () => {
  for (const key of Object.keys(generatedBundle.displayStrings?.en ?? {})) expect(key.startsWith("base.")).toBe(true);
});

test("every {{ CEL }} placeholder of a table string compiles", () => {
  for (const [key, text] of Object.entries(generatedBundle.displayStrings?.en ?? {})) {
    for (const expr of templateExpressions(text)) expect({ key, expr, error: celCheck(expr) }).toEqual({ key, expr, error: undefined });
  }
});

test("the bundle ships only the locales it has tables for", () => {
  expect(Object.keys(generatedBundle.displayStrings ?? {})).toEqual(["en"]);
});
