import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "bun:test";
import { runInit } from "../src/commands/init.ts";
import { runExportCard, runImportCard } from "../src/commands/cards.ts";
import { withCapturedStdout } from "./helpers/io.ts";

test("import-card JSON then export-card round trip", async () => {
  const dir = await mkdtemp(join(tmpdir(), "animae-cards-cmd-"));
  try {
    await runInit({ dir, preset: "@animae/preset-rule" });
    await writeFile(
      join(dir, "st-card.json"),
      JSON.stringify({
        name: "Card Test NPC",
        description: "A traveler",
        first_mes: "Hello.",
        mes_example: "",
      }),
    );
    const imp = await withCapturedStdout(() => runImportCard("st-card.json", { root: dir, mode: "rule" }));
    expect(imp.code).toBe(0);
    expect(imp.out).toContain("Imported character");

    const idMatch = /Imported character (\S+)/.exec(imp.out.trim());
    expect(idMatch?.[1]).toBeDefined();
    const exp = await withCapturedStdout(() => runExportCard(idMatch![1]!, { root: dir, mode: "rule" }));
    expect(exp.code).toBe(0);
    expect(exp.out.trim().length).toBeGreaterThan(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("export-card openEngine failure on missing root", async () => {
  const missing = await mkdtemp(join(tmpdir(), "animae-cards-exp-"));
  await rm(missing, { recursive: true, force: true });
  const { code, err } = await withCapturedStdout(() =>
    runExportCard("player", { root: missing, mode: "rule" }),
  );
  expect(code).toBe(1);
  expect(err.length).toBeGreaterThan(0);
});

test("import-card openEngine failure on missing root", async () => {
  const missing = await mkdtemp(join(tmpdir(), "animae-cards-root-"));
  await rm(missing, { recursive: true, force: true });
  const { code, err } = await withCapturedStdout(() =>
    runImportCard("x.json", { root: missing, mode: "rule" }),
  );
  expect(code).toBe(1);
  expect(err.length).toBeGreaterThan(0);
});

test("import-card missing file returns 1", async () => {
  const dir = await mkdtemp(join(tmpdir(), "animae-cards-bad-"));
  try {
    await runInit({ dir });
    const { code, err } = await withCapturedStdout(() =>
      runImportCard(join(dir, "missing.json"), { root: dir, mode: "rule" }),
    );
    expect(code).toBe(1);
    expect(err.length).toBeGreaterThan(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
