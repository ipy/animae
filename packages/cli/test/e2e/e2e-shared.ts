import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyTutorialToTemp } from "../helpers/fixture-copy.ts";
import { spawnCli, scrubNetworkEnv, writeDemoModOverlay } from "./cli-process.ts";

let tutorialRoot = "";
let tutorialCleanup: (() => Promise<void>) | undefined;

/** Read-only tutorial copy shared by inspect/timeline e2e (created once). */
export async function sharedTutorialRoot(): Promise<string> {
  if (!tutorialRoot) {
    const { dir, cleanup } = await copyTutorialToTemp();
    tutorialRoot = dir;
    tutorialCleanup = cleanup;
  }
  return tutorialRoot;
}

export async function disposeSharedTutorial(): Promise<void> {
  if (tutorialCleanup) {
    await tutorialCleanup();
    tutorialRoot = "";
    tutorialCleanup = undefined;
  }
}

export async function freshRuleRoot(preset = "@animae/preset-rule"): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "animae-cli-e2e-"));
  const env = scrubNetworkEnv();
  const init = await spawnCli({
    args: ["init", dir, "--preset", preset],
    env,
    timeoutMs: 12_000,
  });
  if (init.exitCode !== 0) {
    await rm(dir, { recursive: true, force: true });
    throw new Error(`init failed: ${init.stderr}`);
  }
  return {
    dir,
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

export async function freshRootWithMod(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const { dir, cleanup } = await freshRuleRoot();
  await writeDemoModOverlay(dir);
  return { dir, cleanup };
}

export function rootArgs(root: string, extra: string[] = []): string[] {
  return ["--root", root, ...extra];
}

/** Flags for commands that play turns (run, serve, inspect after live state, …). */
export function playArgs(root: string, extra: string[] = []): string[] {
  return ["--root", root, "--mode", "rule", ...extra];
}
