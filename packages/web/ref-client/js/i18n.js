/** @type {Record<string, string>} */
let catalog = {};
/** @type {string} */
let localeTag = "en";

const STORAGE_KEY = "animae.ref.locale";

/**
 * @param {string} tag
 */
export function normalizeLocaleTag(tag) {
  const t = (tag || "en").trim();
  if (t.toLowerCase().startsWith("zh")) return "zh-CN";
  return "en";
}

export function detectDefaultLocale() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "en" || stored === "zh-CN") return stored;
  return normalizeLocaleTag(navigator.language || "en");
}

/**
 * @param {string} tag
 */
export async function loadCatalog(tag) {
  const normalized = tag === "zh-CN" ? "zh-CN" : "en";
  const res = await fetch(`./locales/${normalized}.json`);
  if (!res.ok) throw new Error(`locale ${normalized}`);
  catalog = await res.json();
  localeTag = normalized;
  localStorage.setItem(STORAGE_KEY, normalized);
  document.documentElement.lang = normalized === "zh-CN" ? "zh-CN" : "en";
  applyDocumentI18n();
  return normalized;
}

export function currentLocale() {
  return localeTag;
}

/**
 * @param {string} key
 * @param {Record<string, string | number>} [params]
 */
export function t(key, params) {
  let s = catalog[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.replaceAll(`{${k}}`, String(v));
    }
  }
  return s;
}

export function applyDocumentI18n() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (key) el.textContent = t(key);
  });
  document.querySelectorAll("[data-i18n-attr]").forEach((el) => {
    const spec = el.getAttribute("data-i18n-attr");
    if (!spec) return;
    for (const part of spec.split(";")) {
      const [attr, key] = part.split(":").map((x) => x.trim());
      if (attr && key) el.setAttribute(attr, t(key));
    }
  });
  const titleKey = document.querySelector("title")?.getAttribute("data-i18n");
  if (titleKey) document.title = t(titleKey);
}

/**
 * @param {Record<string, string>} en
 * @param {Record<string, string>} zh
 */
export function assertCatalogParity(en, zh) {
  const enKeys = Object.keys(en).sort();
  const zhKeys = Object.keys(zh).sort();
  const missingInZh = enKeys.filter((k) => !(k in zh));
  const missingInEn = zhKeys.filter((k) => !(k in en));
  const empty = [...enKeys, ...zhKeys].filter((k, i, arr) => arr.indexOf(k) === i).filter((k) => !en[k]?.trim() || !zh[k]?.trim());
  return { enKeys, zhKeys, missingInZh, missingInEn, empty };
}
