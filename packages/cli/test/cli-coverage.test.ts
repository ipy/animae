import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, expect, test } from "bun:test";
import { formatCliError } from "../src/errors.ts";
import { readPackageVersion } from "../src/version.ts";
import { runCli } from "../src/cli.ts";
import { runInit } from "../src/commands/init.ts";
import { runServe } from "../src/commands/serve.ts";
import { runValidatePresetsOnly } from "../src/commands/validate.ts";
import { validateDataRoot } from "../src/engine-open.ts";
import { withCapturedStdout } from "./helpers/io.ts";
import { copyTutorialToTemp } from "./helpers/fixture-copy.ts";

let dir = "";

afterEach(async () => {
  if (dir) {
    await rm(dir, { recursive: true, force: true });
    dir = "";
  }
});

test("formatCliError handles Error and string", () => {
  expect(formatCliError(new Error("plain"))).toBe("plain");
  expect(formatCliError("text")).toBe("text");
});

test("readPackageVersion returns semver", () => {
  expect(readPackageVersion()).toMatch(/^\d+\.\d+\.\d+/);
});

test("validateDataRoot reports CONFIG_INVALID issues", async () => {
  dir = await mkdtemp(join(tmpdir(), "animae-val-root-"));
  await runInit({ dir });
  await writeFile(join(dir, "characters/player/card.md"), "broken card\n");
  const r = await validateDataRoot(dir);
  expect(r.ok).toBe(false);
  expect(r.issues.length).toBeGreaterThan(0);
});

test("runValidatePresetsOnly prints OK on skeleton", async () => {
  dir = await mkdtemp(join(tmpdir(), "animae-val-preset-"));
  await runInit({ dir, preset: "@animae/preset-rule" });
  const { code, out } = await withCapturedStdout(() => runValidatePresetsOnly(dir));
  expect(code).toBe(0);
  expect(out).toContain("OK");
});

test("runServe rejects missing --stdio", async () => {
  dir = await mkdtemp(join(tmpdir(), "animae-serve-no-stdio-"));
  await runInit({ dir, preset: "@animae/preset-rule" });
  const { code, err } = await withCapturedStdout(() => runServe({ root: dir, mode: "rule", stdio: false }));
  expect(code).toBe(1);
  expect(err).toContain("--stdio");
});

test("runServe openEngine failure on missing root", async () => {
  const missing = await mkdtemp(join(tmpdir(), "animae-serve-miss-"));
  await rm(missing, { recursive: true, force: true });
  const { code, err } = await withCapturedStdout(() => runServe({ root: missing, mode: "rule", stdio: true }));
  expect(code).toBe(1);
  expect(err.length).toBeGreaterThan(0);
});

test("runCli dispatches timeline, gallery, inspect, cards, serve, mods, run, i18n", async () => {
  dir = await mkdtemp(join(tmpdir(), "animae-cli-all-"));
  await runInit({ dir, preset: "@animae/preset-rule" });
  const root = ["--root", dir, "--mode", "rule"] as const;

  expect(await withCapturedStdout(() => runCli([...root, "timeline", "list"], {})).then((r) => r.code)).toBe(0);
  expect(await withCapturedStdout(() => runCli([...root, "gallery", "list"], {})).then((r) => r.code)).toBe(0);
  expect(await withCapturedStdout(() => runCli([...root, "inspect", "world/location"], {})).then((r) => r.code)).toBe(0);
  expect(await withCapturedStdout(() => runCli([...root, "mods", "list"], {})).then((r) => r.code)).toBe(0);
  expect(await withCapturedStdout(() => runCli([...root, "mods", "explain", "world/world.yaml"], {})).then((r) => r.code)).toBe(0);
  expect(await withCapturedStdout(() => runCli([...root, "i18n", "check"], {})).then((r) => r.code)).toBe(0);

  await writeFile(
    join(dir, "st.json"),
    JSON.stringify({ name: "Npc", description: "d", first_mes: "hi", mes_example: "" }),
  );
  const imp = await withCapturedStdout(() => runCli([...root, "import-card", "st.json"], {}));
  expect(imp.code).toBe(0);
  const id = /Imported character (\S+)/.exec(imp.out.trim())?.[1];
  expect(id).toBeDefined();
  expect(await withCapturedStdout(() => runCli([...root, "export-card", id!], {})).then((r) => r.code)).toBe(0);

});

test("runCli parse errors return 1", async () => {
  const { code, err } = await withCapturedStdout(() => runCli(["mods"], {}));
  expect(code).toBe(1);
  expect(err).toContain("mods requires");
});

test("runCli --plain runs colon quit session", async () => {
  dir = await mkdtemp(join(tmpdir(), "animae-cli-run-"));
  await runInit({ dir, preset: "@animae/preset-rule" });
  const stdin = new PassThrough();
  stdin.write(":quit\n");
  stdin.end();
  const origIn = process.stdin;
  Object.defineProperty(process, "stdin", { value: stdin, configurable: true });
  try {
    const { code } = await withCapturedStdout(() =>
      runCli(["--root", dir, "--mode", "rule", "run", "--plain", "--scene", "home"], {}),
    );
    expect(code).toBe(0);
  } finally {
    Object.defineProperty(process, "stdin", { value: origIn, configurable: true });
  }
});

test("copyTutorialToTemp allows engine inspect without touching tracked docs tree", async () => {
  const { dir: copy, cleanup } = await copyTutorialToTemp();
  try {
    const { code } = await withCapturedStdout(() =>
      runCli(["--root", copy, "--mode", "rule", "inspect", "world/location"], {}),
    );
    expect(code).toBe(0);
  } finally {
    await cleanup();
  }
});
