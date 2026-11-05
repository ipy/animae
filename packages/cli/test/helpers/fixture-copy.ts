import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Read-only tutorial tree under docs. Never call `openEngine`, `runInspect`, `run`, `gallery`, or `timeline`
 * against this path — those commands persist under the data root (`gallery/`, `timelines/`). Only `runValidate`
 * is safe in place; engine tests must use {@link copyTutorialToTemp}.
 */
export const tutorialFixtureSrc = join(import.meta.dirname, "../../../../docs/examples/tutorial");

/** Copy the tutorial fixture into an isolated temp data root for engine/CLI tests. */
export async function copyTutorialToTemp(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "animae-tutorial-copy-"));
  await cp(tutorialFixtureSrc, dir, {
    recursive: true,
    filter: (src) => !src.replaceAll("\\", "/").includes("/gallery/"),
  });
  return {
    dir,
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true });
    },
  };
}
