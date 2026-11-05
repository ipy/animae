import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, test } from "bun:test";
import { spawnCli } from "./cli-process.ts";
import { freshRootWithMod, freshRuleRoot, playArgs, rootArgs } from "./e2e-shared.ts";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

test("init then validate human OK and --mode rule", async () => {
  const { dir, cleanup } = await freshRuleRoot();
  cleanups.push(cleanup);

  const val = await spawnCli({ args: rootArgs(dir, ["validate"]) });
  expect(val.exitCode).toBe(0);
  expect(val.stdout.trim()).toBe("OK");

  const rule = await spawnCli({ args: playArgs(dir, ["validate", "--mode", "rule"]) });
  expect(rule.exitCode).toBe(0);
  expect(rule.stdout).toContain("OK (mode rule)");
});

test("mods list, validate, explain on mod overlay root", async () => {
  const { dir, cleanup } = await freshRootWithMod();
  cleanups.push(cleanup);

  const list = await spawnCli({ args: ["--root", dir, "mods", "list"] });
  expect(list.exitCode).toBe(0);
  expect(list.stdout).toContain("e2e-demo-mod");

  const val = await spawnCli({ args: ["--root", dir, "mods", "validate"] });
  expect(val.exitCode).toBe(0);
  expect(val.stdout).toContain("OK");

  const explain = await spawnCli({
    args: ["--root", dir, "mods", "explain", "world/locations/home.yaml", "--mods", "e2e-demo-mod"],
  });
  expect(explain.exitCode).toBe(0);
  expect(explain.stdout.toLowerCase()).toContain("mod");
});

test("broken authored file makes validate exit 1 with file diagnostic", async () => {
  const { dir, cleanup } = await freshRuleRoot();
  cleanups.push(cleanup);
  await writeFile(join(dir, "characters/player/card.md"), "broken frontmatter\n", "utf8");

  const r = await spawnCli({ args: playArgs(dir, ["validate", "--mode", "rule"]) });
  expect(r.exitCode).toBe(1);
  const combined = r.stdout + r.stderr;
  expect(combined).toContain("characters/player/card.md");
  expect(combined).toMatch(/identity|Invalid input/i);
});

test("validate --lang en succeeds on fresh skeleton", async () => {
  const { dir, cleanup } = await freshRuleRoot();
  cleanups.push(cleanup);

  const r = await spawnCli({ args: ["--root", dir, "--lang", "en", "validate"] });
  expect(r.exitCode).toBe(0);
  expect(r.stdout).toContain("OK");
});

test("init refuses overwrite", async () => {
  const { dir, cleanup } = await freshRuleRoot();
  cleanups.push(cleanup);

  const again = await spawnCli({ args: ["init", dir] });
  expect(again.exitCode).toBe(1);
  expect(again.stderr).toContain("Refusing to overwrite");
});
