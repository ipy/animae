import type { RuntimeModePreset } from "@animae/engine";
import { validateDataRoot } from "../engine-open.ts";
import { validateWithMods } from "./mods.ts";

/**
 * `animae validate`. With `mode`, the data root must also be able to play under that runtime mode: a role served by a
 * model needs one configured, and a role served by rules needs its templates (see `checkRuleModeReadiness`).
 */
export async function runValidate(
  root: string,
  modIds?: string[],
  uiLocale?: string,
  mode?: RuntimeModePreset,
): Promise<number> {
  const result = await validateWithMods(root, modIds, uiLocale, mode);
  for (const issue of result.issues) {
    process.stdout.write(`${issue.file}:${issue.path}: ${issue.message}\n`);
  }
  if (!result.ok) return 1;
  process.stdout.write(mode ? `OK (mode ${mode})\n` : "OK\n");
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
