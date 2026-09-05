import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedE2eAuthored } from "../../engine/test/e2e/fixture.ts";
import { FsStorage } from "@animae/engine";

export async function copyDemoDataRoot(): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), "tui-demo-"));
  await seedE2eAuthored(FsStorage(root));
  return {
    root,
    cleanup: async () => {
      await rm(root, { recursive: true, force: true });
    },
  };
}
