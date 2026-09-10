import type { StoragePort } from "../ports.ts";

/** Ensure the content-locale overlay tree exists when games ship locale layers. */
export async function validateContentLocalePresence(
  storage: StoragePort,
  contentLocale: string,
): Promise<string[]> {
  const warnings: string[] = [];
  const localeRoots = await storage.list("locales");
  if (localeRoots.length === 0) return warnings;
  const prefix = `locales/${contentLocale}`;
  const files = await storage.listFiles(prefix);
  if (files.length === 0) {
    warnings.push(`no files under ${prefix}/ (LLM-facing content lane for contentLocale=${contentLocale})`);
  }
  return warnings;
}
