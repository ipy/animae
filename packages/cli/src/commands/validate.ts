import { validateDataRoot } from "../engine-open.ts";
import { validateWithMods } from "./mods.ts";

export async function runValidate(root: string, modIds?: string[]): Promise<number> {
  const result =
    modIds !== undefined ? await validateWithMods(root, modIds) : await validateWithMods(root, undefined);
  for (const issue of result.issues) {
    process.stdout.write(`${issue.file}:${issue.path}: ${issue.message}\n`);
  }
  if (!result.ok) return 1;
  process.stdout.write("OK\n");
  return 0;
}

/** Legacy entry without mod overlay (presets only) — used by tests that expect preset-only validate. */
export async function runValidatePresetsOnly(root: string): Promise<number> {
  const result = await validateDataRoot(root);
  for (const issue of result.issues) {
    process.stdout.write(`${issue.file}:${issue.path}: ${issue.message}\n`);
  }
  if (!result.ok) return 1;
  process.stdout.write("OK\n");
  return 0;
}
