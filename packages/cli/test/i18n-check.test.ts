import { afterEach, expect, test } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { clearLocalePacks, registerLocalePack } from "@animae/i18n";
import { runI18n, smokeI18nCatalog } from "../src/commands/i18n.ts";
import { withCapturedStdout } from "./helpers/io.ts";

afterEach(() => clearLocalePacks());

async function writePackModule(dir: string, body: string): Promise<string> {
  const path = join(dir, "pack.ts");
  await writeFile(path, body, "utf8");
  return path;
}

test("animae i18n check succeeds with no registered locale packs", async () => {
  const code = await runI18n("check", []);
  expect(code).toBe(0);
});

test("animae i18n check --pack loads a locale pack module and reports missing keys", async () => {
  const dir = await mkdtemp(join(tmpdir(), "animae-i18n-pack-"));
  try {
    const packPath = await writePackModule(
      dir,
      `export default {
  locale: "fr",
  catalogs: {
    cli: { "help.summary": "Résumé FR" },
  },
};`,
    );
    const code = await runI18n("check", ["--pack", packPath]);
    expect(code).toBe(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("animae i18n check --pack warns on extra keys vs English", async () => {
  const dir = await mkdtemp(join(tmpdir(), "animae-i18n-pack-"));
  const stderrChunks: string[] = [];
  const orig = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: string | Uint8Array, ...args: unknown[]) => {
    stderrChunks.push(String(chunk));
    return orig(chunk as never, ...(args as never[]));
  }) as typeof process.stderr.write;
  try {
    const packPath = await writePackModule(
      dir,
      `export default {
  locale: "fr",
  catalogs: {
    cli: { "extra.only.key": "surplus" },
  },
};`,
    );
    const code = await runI18n("check", ["--pack", packPath]);
    expect(code).toBe(1);
    const err = stderrChunks.join("");
    expect(err).toMatch(/extra key in fr cli:extra\.only\.key/);
  } finally {
    process.stderr.write = orig;
    await rm(dir, { recursive: true, force: true });
  }
});

test("animae i18n check --pack exits 1 for invalid pack modules", async () => {
  const dir = await mkdtemp(join(tmpdir(), "animae-i18n-pack-"));
  try {
    const packPath = await writePackModule(dir, `export default { locale: "fr" };`);
    const code = await runI18n("check", ["--pack", packPath]);
    expect(code).toBe(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runI18n pseudo prints transformed sample", async () => {
  const { code, out } = await withCapturedStdout(() => runI18n("pseudo", ["Hello"]));
  expect(code).toBe(0);
  expect(out.length).toBeGreaterThan(0);
  expect(out).not.toBe("Hello\n");
});

test("runI18n extract reports not implemented", async () => {
  const { code, err } = await withCapturedStdout(() => runI18n("extract", []));
  expect(code).toBe(0);
  expect(err).toContain("not implemented");
});

test("runI18n unknown subcommand prints usage", async () => {
  const { code, err } = await withCapturedStdout(() => runI18n("nope", []));
  expect(code).toBe(1);
  expect(err).toContain("Usage: animae i18n");
});

test("runI18n check adds gallery prompt parity errors for incomplete locale", async () => {
  registerLocalePack({
    locale: "zz-test",
    catalogs: { cli: { "help.summary": "x" } },
  });
  const { code, err } = await withCapturedStdout(() => runI18n("check", []));
  expect(code).toBe(1);
  expect(err).toMatch(/error:/);
});

test("smokeI18nCatalog resolves engine error string", () => {
  expect(smokeI18nCatalog("en")).toMatch(/config/i);
});

test("runI18n check --pack load failure writes error", async () => {
  const dir = await mkdtemp(join(tmpdir(), "animae-i18n-bad-pack-"));
  try {
    const path = join(dir, "broken.ts");
    await writeFile(path, `throw new Error("load boom");`);
    const { code, err } = await withCapturedStdout(() => runI18n("check", ["--pack", path]));
    expect(code).toBe(1);
    expect(err).toContain("error:");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
