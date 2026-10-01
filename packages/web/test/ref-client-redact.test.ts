// @ts-nocheck — ref-client ES modules are browser-only; Bun tests import them at runtime.
import { expect, test } from "bun:test";
import { findLeakedSecretKeys, isMaskedSecretValue, redactValue, looksLikeSecretKey } from "../ref-client/js/redact.js";

test("looksLikeSecretKey matches common names", () => {
  expect(looksLikeSecretKey("apiKey")).toBe(true);
  expect(looksLikeSecretKey("theme")).toBe(false);
});

test("isMaskedSecretValue accepts bullets and asterisks", () => {
  expect(isMaskedSecretValue("••••")).toBe(true);
  expect(isMaskedSecretValue("****")).toBe(true);
  expect(isMaskedSecretValue("")).toBe(true);
  expect(isMaskedSecretValue("sk-live-real")).toBe(false);
});

test("findLeakedSecretKeys nested", () => {
  const bad = findLeakedSecretKeys({ nested: { token: "plain-secret" } });
  expect(bad).toContain("nested.token");
});

test("redactValue strips sk tokens in strings", () => {
  const out = redactValue({ note: "key sk-1234567890abcdef" });
  expect(JSON.stringify(out)).not.toContain("sk-1234567890abcdef");
});
