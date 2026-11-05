import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, expect, test } from "bun:test";
import { clearLocalePacks, registerLocalePack } from "@animae/i18n";
import { runInit } from "../src/commands/init.ts";
import { runGallery } from "../src/commands/gallery.ts";
import { runI18n } from "../src/commands/i18n.ts";
import { validateWithMods } from "../src/commands/mods.ts";
import { runServe } from "../src/commands/serve.ts";
import { createCommandImagePort } from "../src/image-command-port.ts";
import { withCapturedStdout } from "./helpers/io.ts";

let dir = "";

afterEach(async () => {
  clearLocalePacks();
  if (dir) {
    await rm(dir, { recursive: true, force: true });
    dir = "";
  }
});

async function initRuleRoot(): Promise<string> {
  dir = await mkdtemp(join(tmpdir(), "animae-d2-"));
  await runInit({ dir, preset: "@animae/preset-rule" });
  return dir;
}

test("runRunCommand --plain passes custom viewer", async () => {
  await initRuleRoot();
  const input = Readable.from([":quit\n"]);
  const origStdin = process.stdin;
  Object.defineProperty(process, "stdin", { value: input, configurable: true });
  try {
    const { runRunCommand } = await import("../src/commands/run-cmd.ts");
    const { code } = await withCapturedStdout(() =>
      runRunCommand({
        root: dir,
        mode: "rule",
        plain: true,
        scene: "home",
        viewer: "debug",
      }),
    );
    expect(code).toBe(0);
  } finally {
    Object.defineProperty(process, "stdin", { value: origStdin, configurable: true });
  }
});

test("runServe rejects non-stdio and missing engine root", async () => {
  await initRuleRoot();
  const noStdio = await withCapturedStdout(() => runServe({ root: dir, mode: "rule", stdio: false }));
  expect(noStdio.code).toBe(1);
  expect(noStdio.err).toContain("--stdio");

  const missing = await mkdtemp(join(tmpdir(), "animae-d2-serve-miss-"));
  await rm(missing, { recursive: true, force: true });
  const badRoot = await withCapturedStdout(() => runServe({ root: missing, mode: "rule", stdio: true }));
  expect(badRoot.code).toBe(1);
  expect(badRoot.err.length).toBeGreaterThan(0);
});

test("gallery cancel with no active jobs returns usage error", async () => {
  await initRuleRoot();
  const { code, err } = await withCapturedStdout(() =>
    runGallery("cancel", [], { root: dir, mode: "rule", lang: "en" }),
  );
  expect(code).toBe(1);
  expect(err).toMatch(/no active gallery job/i);
});

test("validateWithMods reports content-locale lane gaps", async () => {
  await initRuleRoot();
  await mkdir(join(dir, "locales", "de"), { recursive: true });
  await writeFile(join(dir, "locales", "de", "placeholder.txt"), "x");

  const localeGap = await validateWithMods(dir, undefined, "en");
  expect(localeGap.ok).toBe(false);
  expect(localeGap.issues.some((i) => i.path.includes("content:"))).toBe(true);
});

test("validateWithMods reports authored locale warnings", async () => {
  await initRuleRoot();
  await writeFile(
    join(dir, "world", "locations", "home.yaml"),
    `id: home
name: Home
description: $t:strings.missing.key
`,
  );
  const result = await validateWithMods(dir);
  expect(result.ok).toBe(false);
  expect(result.issues.some((i) => i.path === "(strings)" && i.message.includes("missing translation"))).toBe(true);
});

test("validateWithMods reports mode/model mismatch under --mode full", async () => {
  await initRuleRoot();
  await writeFile(
    join(dir, "animae.yaml"),
    `preset: "@animae/preset-rule"
appraise:
  backend: llm
`,
  );
  const modeIssue = await validateWithMods(dir, undefined, "en", "full");
  expect(modeIssue.ok).toBe(false);
  expect(modeIssue.issues.some((i) => i.path === "models")).toBe(true);
});

test("validateWithMods maps parse failures to root issues", async () => {
  await initRuleRoot();
  await writeFile(join(dir, "animae.yaml"), "{ not valid yaml: [\n");
  const result = await validateWithMods(dir);
  expect(result.ok).toBe(false);
  expect(result.issues[0]?.file).toBe("(root)");
});

test("runI18n check reports missing prompt and gallery prompt sections", async () => {
  registerLocalePack({
    locale: "fr-gap",
    catalogs: {
      prompts: { intro: "only one section" },
      "gallery-prompts": { brief: "partial" },
    },
  });
  const { code, err } = await withCapturedStdout(() => runI18n("check", []));
  expect(code).toBe(1);
  expect(err).toMatch(/prompt sections missing in fr-GAP/i);
  expect(err).toMatch(/gallery prompt sections missing in fr-GAP/i);
});

test("createCommandImagePort rejects non-image payload with enough bytes", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "animae-d2-img-"));
  const script = join(tmp, "opaque.sh");
  await writeFile(
    script,
    `#!/bin/sh
cat >/dev/null
printf 'ABCDEFGHIJKLMNOP'
`,
  );
  await chmod(script, 0o755);
  try {
    const port = createCommandImagePort({ command: script });
    await expect(
      port.generate({ label: "cg", prompt: "x", width: 8, height: 8, rating: "general" }),
    ).rejects.toMatchObject({ code: "GALLERY_GENERATION_FAILED" });
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("readPackageVersion reads the manifest and falls back when it is unreadable or has no version", async () => {
  const { readPackageVersion } = await import("../src/version.ts");
  expect(readPackageVersion(() => '{"version":"2.3.4"}')).toBe("2.3.4");
  expect(readPackageVersion(() => "{}")).toBe("1.0.0");
  expect(readPackageVersion(() => "not json")).toBe("1.0.0");
  expect(
    readPackageVersion(() => {
      throw new Error("unreadable");
    }),
  ).toBe("1.0.0");
  expect(readPackageVersion()).toMatch(/^\d+\.\d+\.\d+/);
});
