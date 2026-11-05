import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "bun:test";
import type { RunTuiOptions } from "@animae/tui";
import { runInit } from "../src/commands/init.ts";
import { runRunCommand } from "../src/commands/run-cmd.ts";
import { withCapturedStdout } from "./helpers/io.ts";

let dir = "";

afterEach(async () => {
  if (dir) {
    await rm(dir, { recursive: true, force: true });
    dir = "";
  }
});

test("runRunCommand without --plain hands the opened engine, viewer, theme and locale to runTui", async () => {
  dir = await mkdtemp(join(tmpdir(), "animae-run-tui-"));
  await runInit({ dir, preset: "@animae/preset-rule" });
  const seen: RunTuiOptions[] = [];
  const { code, err } = await withCapturedStdout(() =>
    runRunCommand(
      { root: dir, mode: "rule", scene: "home", viewer: "debug", theme: "demo", lang: "en" },
      {
        loadTui: async () => ({
          runTui: async (opts: RunTuiOptions) => {
            seen.push(opts);
          },
        }),
      },
    ),
  );
  expect(code).toBe(0);
  expect(err).toBe("");
  expect(seen).toHaveLength(1);
  const opts = seen[0]!;
  expect(opts.viewer).toBe("debug");
  expect(opts.theme).toBe("demo");
  expect(opts.uiLocale).toBe("en");
  expect(opts.scene !== undefined && "sceneId" in opts.scene).toBe(true);
  expect(opts.engine.info().locale).toBe("en");
});

test("runRunCommand reports a TUI failure and still closes the engine", async () => {
  dir = await mkdtemp(join(tmpdir(), "animae-run-tui-fail-"));
  await runInit({ dir, preset: "@animae/preset-rule" });
  const { code, err } = await withCapturedStdout(() =>
    runRunCommand(
      { root: dir, mode: "rule", scene: "home" },
      {
        loadTui: async () => ({
          runTui: async () => {
            throw new Error("terminal exploded");
          },
        }),
      },
    ),
  );
  expect(code).toBe(1);
  expect(err).toContain("terminal exploded");
});
