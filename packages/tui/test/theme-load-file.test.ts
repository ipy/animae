import { afterEach, expect, test } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadTheme } from "../src/theme/load.ts";
import { defaultTheme } from "../src/theme/defaults.ts";

let dir: string | undefined;

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

test("loadTheme reads a yaml file from disk", async () => {
  dir = await mkdtemp(join(tmpdir(), "animae-tui-theme-"));
  const path = join(dir, "theme.yaml");
  await writeFile(
    path,
    `typewriter:
  charsPerSecond: 99
  enabled: false
sidePanel:
  width: 25
  show: [participants]
`,
    "utf8",
  );
  const theme = loadTheme(path);
  expect(theme.typewriter.charsPerSecond).toBe(99);
  expect(theme.sidePanel.widthPercent).toBe(25);
});

test("loadTheme accepts a complete in-memory theme", () => {
  const prev = process.env.NO_COLOR;
  delete process.env.NO_COLOR;
  const theme = loadTheme(defaultTheme);
  if (prev === undefined) delete process.env.NO_COLOR;
  else process.env.NO_COLOR = prev;
  expect(theme.border).toBe(defaultTheme.border);
  expect(theme.sidePanel.widthPercent).toBe(defaultTheme.sidePanel.widthPercent);
});

test("loadTheme applies NO_COLOR to file-loaded themes", async () => {
  const prev = process.env.NO_COLOR;
  process.env.NO_COLOR = "1";
  dir = await mkdtemp(join(tmpdir(), "animae-tui-theme-"));
  const path = join(dir, "plain.yaml");
  await writeFile(path, "colors:\n  primary: red\n  npc: blue\n  player: green\n  narration: gray\n  warning: yellow\nborder: single\ntypewriter:\n  charsPerSecond: 10\n  enabled: true\nsidePanel:\n  width: 20\n  show: []\nbell: false\n", "utf8");
  const theme = loadTheme(path);
  if (prev === undefined) delete process.env.NO_COLOR;
  else process.env.NO_COLOR = prev;
  expect(theme.colors.primary).toBe(theme.colors.narration);
});
