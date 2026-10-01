// @ts-nocheck
import { expect, test } from "bun:test";
import { readFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { assertCatalogParity } from "../ref-client/js/i18n.js";

const refRoot = join(dirname(fileURLToPath(import.meta.url)), "../ref-client");

test("locale catalogs parity and non-empty", async () => {
  const en = JSON.parse(await readFile(join(refRoot, "locales/en.json"), "utf8"));
  const zh = JSON.parse(await readFile(join(refRoot, "locales/zh-CN.json"), "utf8"));
  const { missingInZh, missingInEn, empty } = assertCatalogParity(en, zh);
  expect(missingInZh).toEqual([]);
  expect(missingInEn).toEqual([]);
  expect(empty).toEqual([]);
});

test("html and js i18n keys exist in catalogs", async () => {
  const en = JSON.parse(await readFile(join(refRoot, "locales/en.json"), "utf8")) as Record<string, string>;
  const html = await readFile(join(refRoot, "index.html"), "utf8");
  const keys = new Set<string>();
  for (const m of html.matchAll(/data-i18n="([^"]+)"/g)) keys.add(m[1]!);
  for (const m of html.matchAll(/data-i18n-attr="[^"]*?:(\w[\w.]*)"/g)) keys.add(m[1]!);
  const jsDir = join(refRoot, "js");
  const jsFiles = (await readdir(jsDir)).filter((f) => f.endsWith(".js"));
  for (const file of jsFiles) {
    const src = await readFile(join(jsDir, file), "utf8");
    for (const m of src.matchAll(/\bt\(\s*["']([\w.]+)["']/g)) keys.add(m[1]!);
  }
  for (const id of [
    "socket_open",
    "hello_ok",
    "snapshot_shape",
    "ping_rtt",
    "locale_negotiation",
    "config_get_secrets",
    "llm_log",
    "get_state_version",
    "resume_quiet",
  ]) {
    keys.add(`smoke.desc.${id}`);
  }
  for (const st of ["pass", "fail", "warn", "skip"]) keys.add(`smoke.status.${st}`);
  for (const st of ["ok", "error", "aborted"]) keys.add(`llm.status.${st}`);
  for (const id of ["hostConfigDir", "hostDataDir", "hostSessionDir", "appVersion"]) keys.add(`env.${id}`);
  for (const k of keys) {
    expect(en[k], `missing key ${k}`).toBeTruthy();
  }
});
