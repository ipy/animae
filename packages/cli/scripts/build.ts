#!/usr/bin/env bun
import { readFile } from "node:fs/promises";
import { mkdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertSingletonInkReactBundle } from "./bundle-singleton-guard.ts";
import { inkCompileBundlerFlags } from "./ink-compile-options.ts";

const cliRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const animaeRoot = join(cliRoot, "..", "..");
const distDir = join(animaeRoot, "dist");
const binTs = join(cliRoot, "src", "bin.ts");
const outBin = join(distDir, "animae");
const metafile = join(distDir, ".bundle-meta.json");

const passthrough: string[] = [];
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i]!;
  if (a === "--target" && process.argv[i + 1]) {
    passthrough.push("--target", process.argv[++i]!);
  } else if (a.startsWith("--target=")) {
    passthrough.push(a);
  }
}

async function run(cmd: string[], cwd: string): Promise<void> {
  const proc = Bun.spawn(cmd, { cwd, stdout: "inherit", stderr: "inherit" });
  const code = await proc.exited;
  if (code !== 0) process.exit(code);
}

async function adHocSign(bin: string): Promise<void> {
  if (process.platform !== "darwin") return;
  await run(["codesign", "--force", "--sign", "-", bin], cliRoot);
}

await mkdir(distDir, { recursive: true });

console.log("Building Node-compatible CLI (tsc)…");
const tsc = Bun.spawn(["bun", "run", "build"], { cwd: cliRoot, stdout: "inherit", stderr: "inherit" });
const tscCode = await tsc.exited;
if (tscCode !== 0) {
  console.warn("tsc build skipped (fix engine/types first); continuing with bun --compile only.");
}

console.log("Compiling single executable…");
const compileArgs = [
  "build",
  binTs,
  "--compile",
  "--minify",
  "--production",
  "--outfile",
  outBin,
  ...inkCompileBundlerFlags(metafile),
  ...passthrough,
];
await run(["bun", ...compileArgs], cliRoot);

const meta = JSON.parse(await readFile(metafile, "utf8")) as Parameters<
  typeof assertSingletonInkReactBundle
>[0];
assertSingletonInkReactBundle(meta, "animae compile");

await adHocSign(outBin);

const st = await stat(outBin);
console.log(`Executable: ${outBin} (${st.size} bytes)`);
