import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { engineCatalogs, galleryPromptLocaleParityKeys, promptLocaleParityKeys } from "@animae/engine";
import {
  applyPseudoLocale,
  createI18n,
  registerLocalePack,
  registeredLocales,
  runI18nCheck,
  type LocalePack,
} from "@animae/i18n";
import { tuiCatalogs } from "@animae/tui";
import { hostPackageCatalogs } from "@animae/host";
import { webPackageCatalogs } from "@animae/web";
import { cliCatalogs } from "../i18n/cli-i18n.ts";

const PACKAGES_ROOT = join(import.meta.dir, "../../..");

const USAGE = `Usage: animae i18n check [--pack <module>]... | pseudo [text] | extract

  check     Compare every registered locale pack with the English catalogs: missing keys, placeholder
            mismatches, prompt sections. --pack <module> loads a pack first: an ES module whose default
            export is a locale pack, { locale, catalogs } (repeatable).
  pseudo    Print the text in the pseudo-locale used to spot hard-coded strings.
`;

export async function runI18n(sub: string, rest: string[]): Promise<number> {
  switch (sub) {
    case "check":
      return runI18nCheckCmd(rest);
    case "pseudo": {
      const sample = rest.join(" ") || "Sample UI string";
      const out = applyPseudoLocale(sample, "xx-pseudo");
      process.stdout.write(`${out}\n`);
      return 0;
    }
    case "extract":
      process.stderr.write("animae i18n extract: not implemented (use static catalogs + i18n check)\n");
      return 0;
    default:
      process.stderr.write(USAGE);
      return 1;
  }
}

function packModules(rest: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--pack" && rest[i + 1]) out.push(rest[++i]!);
  }
  return out;
}

async function loadPack(spec: string): Promise<LocalePack> {
  const mod = (await import(pathToFileURL(resolve(spec)).href)) as { default?: unknown; pack?: unknown };
  const pack = (mod.default ?? mod.pack) as Partial<LocalePack> | undefined;
  if (!pack || typeof pack.locale !== "string" || typeof pack.catalogs !== "object" || pack.catalogs === null) {
    throw new Error(`${spec}: expected a default export of the form { locale, catalogs }`);
  }
  return pack as LocalePack;
}

async function runI18nCheckCmd(rest: string[]): Promise<number> {
  for (const spec of packModules(rest)) {
    try {
      registerLocalePack(await loadPack(spec));
    } catch (e) {
      process.stderr.write(`error: ${e instanceof Error ? e.message : String(e)}\n`);
      return 1;
    }
  }
  const catalogs = {
    ...engineCatalogs,
    ...tuiCatalogs,
    ...hostPackageCatalogs,
    ...webPackageCatalogs,
    ...cliCatalogs,
  };
  const locales = registeredLocales();
  const result = await runI18nCheck({
    referenceLocale: "en",
    locales,
    catalogs,
    scanRoots: [
      join(PACKAGES_ROOT, "packages/engine/src"),
      join(PACKAGES_ROOT, "packages/tui/src"),
      join(PACKAGES_ROOT, "packages/cli/src"),
      join(PACKAGES_ROOT, "packages/host/src"),
      join(PACKAGES_ROOT, "packages/web/src"),
      join(PACKAGES_ROOT, "packages/i18n/src"),
    ],
  });
  for (const loc of locales) {
    const prompt = promptLocaleParityKeys(loc);
    if (prompt.missing.length && registeredLocales("prompts").includes(loc)) {
      result.errors.push(`prompt sections missing in ${loc}: ${prompt.missing.join(", ")}`);
      result.ok = false;
    }
    const gallery = galleryPromptLocaleParityKeys(loc);
    if (gallery.missing.length && registeredLocales("gallery-prompts").includes(loc)) {
      result.errors.push(`gallery prompt sections missing in ${loc}: ${gallery.missing.join(", ")}`);
      result.ok = false;
    }
  }
  for (const w of result.warnings) process.stderr.write(`warn: ${w}\n`);
  if (!result.ok) {
    for (const e of result.errors) process.stderr.write(`error: ${e}\n`);
    return 1;
  }
  process.stdout.write(
    locales.length ? `i18n check OK (${locales.join(", ")})\n` : "i18n check OK (no locale packs registered; English only)\n",
  );
  return 0;
}

/** Smoke: embedded catalogs resolve in compiled-style static imports. */
export function smokeI18nCatalog(locale: string): string {
  const i18n = createI18n({ locale, catalogs: { errors: engineCatalogs.errors }, defaultNamespace: "errors" });
  return i18n.t("config.invalid");
}
