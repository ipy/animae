// @ts-nocheck
import { afterEach, expect, test } from "bun:test";
import { readFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { clearLocalePacks, flattenCatalog, localeCatalogs, registeredLocales } from "@animae/i18n";
import { SessionHost } from "@animae/host";
import { createMemoryAssetProvider, createWebServer } from "../src/index.ts";
import { assertCatalogParity } from "../ref-client/js/i18n.js";
import { registerFrenchSessionLocalePack, registerFrenchWebClientPack } from "./helpers/locale-packs.ts";
import { galleryStub } from "./helpers/stub-engine.ts";
import type { Engine } from "@animae/engine";

const refRoot = join(dirname(fileURLToPath(import.meta.url)), "../ref-client");

afterEach(() => clearLocalePacks());

function stubEngine(): Engine {
  return {
    world: { now: () => ({ day: 1, minute: 0 }) },
    query: () => ({}),
    timeline: { current: () => ({ name: "main" }) },
    scene: { start: async () => "s", end: async () => {}, turn: async function* () {} },
    mods: () => null,
    on: () => () => {},
    gallery: galleryStub(),
  } as unknown as Engine;
}

test("registered web-client packs stay in parity with the English ref catalog", async () => {
  const en = JSON.parse(await readFile(join(refRoot, "locales/en.json"), "utf8")) as Record<string, string>;
  const frCatalog: Record<string, string> = {};
  for (const [key, value] of Object.entries(en)) {
    frCatalog[key] = key.startsWith("app.") ? `FR ${value}` : value;
  }
  const off = registerFrenchWebClientPack(frCatalog);
  try {
    const merged = flattenCatalog(localeCatalogs("web-client", { en }).fr ?? {});
    expect(registeredLocales("web-client")).toContain("fr");
    const { missingInTranslated, missingInReference, empty } = assertCatalogParity(en, merged);
    expect(missingInTranslated).toEqual([]);
    expect(missingInReference).toEqual([]);
    expect(empty).toEqual([]);
  } finally {
    off();
  }
});

test("html and js i18n keys exist in the English catalog", async () => {
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

test("/api/client-catalog serves registered packs and per-key English fallback in the client merge", async () => {
  const en = JSON.parse(await readFile(join(refRoot, "locales/en.json"), "utf8")) as Record<string, string>;
  const sampleKey = "app.title";
  const off = registerFrenchWebClientPack({ [sampleKey]: "Console de diagnostic Animae" });
  const host = new SessionHost({ engine: stubEngine() });
  const port = 18100 + Math.floor(Math.random() * 500);
  const handle = createWebServer({
    host,
    port,
    bindHost: "127.0.0.1",
    assets: createMemoryAssetProvider({}),
  });
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/client-catalog?locale=fr`);
    expect(res.ok).toBe(true);
    const body = (await res.json()) as { locale: string; catalog: Record<string, string> };
    expect(body.locale).toBe("fr");
    expect(body.catalog[sampleKey]).toBe("Console de diagnostic Animae");
    expect(body.catalog["app.intro"]).toBeUndefined();
    const merged = { ...en, ...body.catalog };
    expect(merged[sampleKey]).toBe("Console de diagnostic Animae");
    expect(merged["app.intro"]).toBe(en["app.intro"]);
  } finally {
    handle.stop();
    off();
  }
});

test("/api/locales lists registered pack locales", async () => {
  const off = registerFrenchSessionLocalePack();
  const host = new SessionHost({ engine: stubEngine() });
  const port = 18200 + Math.floor(Math.random() * 500);
  const handle = createWebServer({
    host,
    port,
    bindHost: "127.0.0.1",
    assets: createMemoryAssetProvider({}),
  });
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/locales?locale=en`);
    expect(res.ok).toBe(true);
    const body = (await res.json()) as { locales: Array<{ tag: string; name: string }> };
    const tags = body.locales.map((l) => l.tag);
    expect(tags).toContain("en");
    expect(tags).toContain("fr");
  } finally {
    handle.stop();
    off();
  }
});

test("loadCatalog merge matches English fallback for partial server catalogs", async () => {
  const en = JSON.parse(await readFile(join(refRoot, "locales/en.json"), "utf8")) as Record<string, string>;
  const overlay = { "status.connected": "Connecté" };
  const merged = { ...en, ...overlay };
  expect(merged["status.connected"]).toBe("Connecté");
  expect(merged["app.title"]).toBe(en["app.title"]);
});
