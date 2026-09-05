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

export function loadTheme(source: Theme | ThemePatch | string | undefined): Theme {
  if (source === undefined) return defaultTheme;
  if (typeof source !== "string") {
    if (isCompleteTheme(source)) return source;
    return mergeTheme(themeSchema.parse(source));
  }
  const raw = readFileSync(source, "utf8");
  const doc = parseYaml(raw);
  const parsed = themeSchema.parse(doc);
  return mergeTheme(parsed);
}
