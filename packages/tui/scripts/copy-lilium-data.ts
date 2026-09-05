import { cp, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const SKIP = new Set(["timelines", ".animae.lock"]);

const liliumData = join(
  fileURLToPath(new URL("../../../../games/lilium", import.meta.url)),
  "data",
);

export function liliumDataSourceDir(): string {
  return liliumData;
}

export async function copyLiliumDataRoot(): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), "tui-lilium-"));
  await cp(liliumData, root, {
    recursive: true,
    filter: (path) => {
      const parts = path.replace(/\\/g, "/").split("/");
      return !parts.some((p) => SKIP.has(p));
    },
  });
  return {
    root,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}
