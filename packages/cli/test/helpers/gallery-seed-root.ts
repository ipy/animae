import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FsStorage } from "@animae/engine";
import { seedGalleryEngineRoot } from "../../../engine/test/gallery/fixture.ts";

/** Isolated data root with gallery authored content (e2e preset). */
export async function createGallerySeedRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "animae-cli-gallery-seed-"));
  await seedGalleryEngineRoot(FsStorage(dir));
  return dir;
}
