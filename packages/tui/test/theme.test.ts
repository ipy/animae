import { test, expect } from "bun:test";
import { mergeTheme, themeSchema } from "../src/theme/schema.ts";
import { loadTheme } from "../src/theme/load.ts";

test("themeSchema validates yaml-shaped object", () => {
  const parsed = themeSchema.parse({
    colors: { primary: "cyan", npc: "magenta", player: "green", narration: "gray", warning: "yellow" },
    border: "round",
    typewriter: { charsPerSecond: 40, enabled: false },
    sidePanel: { width: 30, show: ["participants", "tracks", "fields", "anchor"] },
    bell: true,
  });
  const theme = mergeTheme(parsed);
  expect(theme.typewriter.charsPerSecond).toBe(40);
  expect(theme.bell).toBe(true);
  expect(theme.sidePanel.widthPercent).toBe(30);
  expect(theme.colors.primary).toBe("cyan");
});

test("loadTheme merges partial overrides", () => {
  const prev = process.env.NO_COLOR;
  delete process.env.NO_COLOR;
  const theme = loadTheme({ typewriter: { charsPerSecond: 12, enabled: false } });
  if (prev !== undefined) process.env.NO_COLOR = prev;
  expect(theme.typewriter.charsPerSecond).toBe(12);
  expect(theme.typewriter.enabled).toBe(false);
  expect(theme.colors.primary).toBe("cyan");
});
