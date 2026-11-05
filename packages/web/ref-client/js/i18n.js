/** @type {Record<string, string>} */
let catalog = {};
/** @type {string} */
let localeTag = "en";

const STORAGE_KEY = "animae.ref.locale";

/**
 * @param {string} tag
 */
export function normalizeLocaleTag(tag) {
  const t = (tag || "en").trim().replace(/_/g, "-");
  return t || "en";
}

export function detectDefaultLocale() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) return normalizeLocaleTag(stored);
  return normalizeLocaleTag(navigator.language || "en");
}

/**
 * `tag` and its less specific tags: `pt-BR` → `pt-BR`, `pt`.
 * @param {string} tag
 */
function lessSpecific(tag) {
  const parts = tag.split("-");
  const out = [];
  for (let n = parts.length; n >= 1; n--) out.push(parts.slice(0, n).join("-"));
  return out;
}

/**
 * @param {string} url
 * @returns {Promise<any | null>}
 */
async function fetchJson(url) {
  try {
    const res = await fetch(url);
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/**
 * Loads the English catalog, then lays the requested locale over it, so a key a translation lacks reads in English.
 * A translation is looked for as `./locales/<tag>.json` next to this client, then on the server, which serves the
 * `web-client` catalog of the locale packs registered by the host application (`/api/client-catalog`).
 * Resolves to the locale that was actually loaded.
 * @param {string} tag
 */
export async function loadCatalog(tag) {
  const wanted = normalizeLocaleTag(tag);
  const base = await fetchJson("./locales/en.json");
  if (!base) throw new Error("locale en");
  let overlay = null;
  let resolved = "en";
  if (wanted.toLowerCase() !== "en") {
    for (const candidate of lessSpecific(wanted)) {
      overlay = await fetchJson(`./locales/${candidate}.json`);
      if (overlay) {
        resolved = candidate;
        break;
      }
    }
    if (!overlay) {
      const served = await fetchJson(`/api/client-catalog?locale=${encodeURIComponent(wanted)}`);
      if (served && served.catalog && Object.keys(served.catalog).length > 0) {
        overlay = served.catalog;
        resolved = String(served.locale);
      }
    }
  }
  catalog = { ...base, ...(overlay ?? {}) };
  localeTag = resolved;
  localStorage.setItem(STORAGE_KEY, resolved);
  document.documentElement.lang = resolved;
  applyDocumentI18n();
  return resolved;
}

/**
 * The UI locales the server can serve, as `{ tag, name }`; English alone when the server does not say.
 * @param {string} [displayLocale] locale the names are written in
 * @returns {Promise<{ tag: string, name: string }[]>}
 */
export async function loadLocaleOptions(displayLocale) {
  const served = await fetchJson(`/api/locales?locale=${encodeURIComponent(displayLocale || "en")}`);
  const list = served && Array.isArray(served.locales) ? served.locales : [];
  return list.length > 0 ? list : [{ tag: "en", name: "English" }];
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
 * Compares a translated catalog with the English reference.
 * @param {Record<string, string>} reference
 * @param {Record<string, string>} translated
 */
export function assertCatalogParity(reference, translated) {
  const referenceKeys = Object.keys(reference).sort();
  const translatedKeys = Object.keys(translated).sort();
  const missingInTranslated = referenceKeys.filter((k) => !(k in translated));
  const missingInReference = translatedKeys.filter((k) => !(k in reference));
  const empty = [...referenceKeys, ...translatedKeys]
    .filter((k, i, arr) => arr.indexOf(k) === i)
    .filter((k) => !reference[k]?.trim() || !translated[k]?.trim());
  return { referenceKeys, translatedKeys, missingInTranslated, missingInReference, empty };
}
