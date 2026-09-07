import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { mergeTheme, themeSchema, type ThemePatch } from "./schema.ts";
import { defaultTheme } from "./defaults.ts";
import type { Theme } from "../types.ts";

function isCompleteTheme(source: ThemePatch | Theme): source is Theme {
  return (
    typeof source.sidePanel === "object" &&
    source.sidePanel !== null &&
    "widthPercent" in source.sidePanel
  );
}

function applyNoColor(theme: Theme): Theme {
  if (process.env.NO_COLOR === undefined) return theme;
  const plain = theme.colors.narration;
  const colors = { ...theme.colors };
  for (const k of Object.keys(colors) as Array<keyof Theme["colors"]>) {
    colors[k] = plain;
  }
  return { ...theme, colors, border: "single" };
}

export function loadTheme(source: Theme | ThemePatch | string | undefined): Theme {
  if (source === undefined) return applyNoColor(defaultTheme);
  if (typeof source !== "string") {
    if (isCompleteTheme(source)) return applyNoColor(source);
    return applyNoColor(mergeTheme(themeSchema.parse(source)));
  }
  const raw = readFileSync(source, "utf8");
  const doc = parseYaml(raw);
  const parsed = themeSchema.parse(doc);
  return applyNoColor(mergeTheme(parsed));
}
