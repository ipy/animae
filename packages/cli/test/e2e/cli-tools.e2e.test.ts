import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { clearLocalePacks } from "@animae/i18n";
import { spawnCli } from "./cli-process.ts";
import {
  disposeSharedTutorial,
  freshRuleRoot,
  playArgs,
  rootArgs,
  sharedTutorialRoot,
} from "./e2e-shared.ts";

const cleanups: Array<() => Promise<void>> = [];
let tutorialDir = "";

beforeAll(async () => {
  tutorialDir = await sharedTutorialRoot();
});

afterAll(async () => {
  await disposeSharedTutorial();
});

afterEach(async () => {
  clearLocalePacks();
  while (cleanups.length) await cleanups.pop()!();
});

test("inspect and timeline after plain session", async () => {
  const { dir, cleanup } = await freshRuleRoot();
  cleanups.push(cleanup);

  const prep = await spawnCli({
    args: playArgs(dir, ["run", "--plain", "--scene", "home"]),
    stdin: "inspect timeline e2e\n:quit\n",
    timeoutMs: 14_000,
  });
  expect(prep.exitCode).toBe(0);

  const events = await spawnCli({
    args: playArgs(dir, ["inspect", "events", "--kind", "input.received", "--viewer", "debug"]),
    timeoutMs: 12_000,
  });
  expect(events.exitCode).toBe(0);
  expect(events.stdout).toContain("input.received");

  const list = await spawnCli({ args: playArgs(dir, ["timeline", "list"]), timeoutMs: 12_000 });
  expect(list.exitCode).toBe(0);
  expect(list.stdout).toContain("branch:");

  const save = await spawnCli({ args: playArgs(dir, ["timeline", "save", "e2e-slot"]), timeoutMs: 12_000 });
  expect(save.exitCode).toBe(0);
  expect(save.stdout).toContain("e2e-slot");
});

test("validate tutorial copy via CLI (read-only fixture)", async () => {
  const val = await spawnCli({
    args: playArgs(tutorialDir, ["validate", "--mode", "rule"]),
    timeoutMs: 14_000,
  });
  expect(val.exitCode).toBe(0);
  expect(val.stdout).toContain("OK");
});

test("import-card and export-card round trip via CLI", async () => {
  const { dir, cleanup } = await freshRuleRoot();
  cleanups.push(cleanup);
  await writeFile(
    join(dir, "npc.json"),
    JSON.stringify({ name: "E2E NPC", description: "test", first_mes: "Hi", mes_example: "" }),
    "utf8",
  );

  const imp = await spawnCli({
    args: playArgs(dir, ["import-card", "npc.json"]),
    cwd: dir,
    timeoutMs: 12_000,
  });
  expect(imp.exitCode).toBe(0);
  expect(imp.stdout).toContain("Imported character");
  const idMatch = /Imported character (\S+)/.exec(imp.stdout.trim());
  expect(idMatch?.[1]).toBeDefined();

  const exp = await spawnCli({ args: playArgs(dir, ["export-card", idMatch![1]!]), cwd: dir, timeoutMs: 12_000 });
  expect(exp.exitCode).toBe(0);
  expect(exp.stdout.trim().length).toBeGreaterThan(10);
});

test("gallery offline list and capture failure without image command", async () => {
  const { dir, cleanup } = await freshRuleRoot();
  cleanups.push(cleanup);

  const list = await spawnCli({ args: playArgs(dir, ["gallery", "list"]), timeoutMs: 12_000 });
  expect(list.exitCode).toBe(0);
  expect(list.stdout).toContain("Gallery is empty.");

  const cap = await spawnCli({ args: playArgs(dir, ["gallery", "capture"]), timeoutMs: 12_000 });
  expect(cap.exitCode).toBe(1);
  expect(cap.stderr + cap.stdout).toContain("GALLERY_NO_GENERATOR");
});

test("i18n check on fresh tree and broken pack module", async () => {
  const check = await spawnCli({ args: ["i18n", "check"], timeoutMs: 12_000 });
  expect(check.exitCode).toBe(0);

  const packDir = await mkdtemp(join(tmpdir(), "animae-i18n-e2e-"));
  const packPath = join(packDir, "bad-pack.ts");
  await writeFile(packPath, `export default { locale: "fr" };`, "utf8");
  try {
    const bad = await spawnCli({ args: ["i18n", "check", "--pack", packPath], timeoutMs: 12_000 });
    expect(bad.exitCode).toBe(1);
    expect(bad.stderr).toContain("expected a default export of the form { locale, catalogs }");
  } finally {
    await rm(packDir, { recursive: true, force: true });
  }

  const pseudo = await spawnCli({ args: ["i18n", "pseudo", "Hello"], timeoutMs: 8_000 });
  expect(pseudo.exitCode).toBe(0);
  expect(pseudo.stdout.trim()).toBe("[Ħëłłö··]");
});
