import { join } from "node:path";
import { engineCatalogs, promptLocaleParityKeys } from "@animae/engine";
import { runI18nCheck, applyPseudoLocale, createI18n } from "@animae/i18n";
import { tuiCatalogs } from "@animae/tui";
import { hostPackageCatalogs } from "@animae/host";
import { webPackageCatalogs } from "@animae/web";

const ANIMae_ROOT = join(import.meta.dir, "../../..");

export async function runI18n(sub: string, rest: string[]): Promise<number> {
  switch (sub) {
    case "check":
      return runI18nCheckCmd();
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
      process.stderr.write(`Usage: animae i18n check|pseudo [text]|extract\n`);
      return 1;
  }
}

async function runI18nCheckCmd(): Promise<number> {
  const catalogs = { ...engineCatalogs, ...tuiCatalogs, ...hostPackageCatalogs, ...webPackageCatalogs };
  const result = await runI18nCheck({
    referenceLocale: "en",
    locales: ["zh-CN"],
    catalogs,
    scanRoots: [
      join(ANIMae_ROOT, "packages/engine/src"),
      join(ANIMae_ROOT, "packages/tui/src"),
      join(ANIMae_ROOT, "packages/cli/src"),
      join(ANIMae_ROOT, "packages/host/src"),
      join(ANIMae_ROOT, "packages/web/src"),
      join(ANIMae_ROOT, "packages/i18n/src"),
    ],
  });
  const prompt = promptLocaleParityKeys();
  if (prompt.missing.length) {
    result.errors.push(`prompt templates missing in zh-CN: ${prompt.missing.join(", ")}`);
    result.ok = false;
  }
  for (const w of result.warnings) process.stderr.write(`warn: ${w}\n`);
  if (!result.ok) {
    for (const e of result.errors) process.stderr.write(`error: ${e}\n`);
    return 1;
  }
  process.stdout.write("i18n check OK\n");
  return 0;
}

/** Smoke: embedded catalogs resolve in compiled-style static imports. */
export function smokeI18nCatalog(locale: string): string {
  const i18n = createI18n({ locale, catalogs: engineCatalogs, defaultNamespace: "errors" });
  return i18n.t("config.invalid");
}
