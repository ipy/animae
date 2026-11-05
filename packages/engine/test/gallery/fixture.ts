import type { GalleryJobView, GalleryService } from "../../src/gallery/types.ts";
import type { StoragePort } from "../../src/ports.ts";

/** Resolves with the job once it reaches a terminal state, instead of sleeping for a guessed duration. */
export function waitForJob(
  gallery: Pick<GalleryService, "jobs" | "subscribe">,
  jobId: string,
  timeoutMs = 5000,
): Promise<GalleryJobView> {
  const terminal = (j: GalleryJobView) => j.state === "done" || j.state === "failed" || j.state === "cancelled";
  return new Promise((resolve, reject) => {
    let off = () => {};
    const timer = setTimeout(() => {
      off();
      reject(new Error(`gallery job ${jobId} was still running after ${timeoutMs} ms`));
    }, timeoutMs);
    const finish = (job: GalleryJobView) => {
      clearTimeout(timer);
      off();
      resolve(job);
    };
    off = gallery.subscribe((n) => {
      if (n.type === "job" && n.job.id === jobId && terminal(n.job)) finish(n.job);
    });
    const current = gallery.jobs().find((j) => j.id === jobId);
    if (current && terminal(current)) finish(current);
  });
}

export async function seedGalleryAuthored(storage: StoragePort): Promise<void> {
  await storage.writeAtomic(
    "animae.yaml",
    `seed: 7
preset: e2e
policies: []
gallery:
  defaultRating: general
  style: "masterpiece, scenic"
  negative: "lowres, watermark"
  ratings:
    general:
      label: General
      when: "true"
    restricted:
      label: Restricted
      when: "'tier:restricted' in image.tags"
  entries:
    dawn-greenhouse:
      title: Dawn greenhouse
      hint: Unlock by caring for plants together.
      rating: general
      order: 10
      characters: [player, npc1]
      unlock:
        when: "event.type == 'care'"
      render:
        prompt: "two people in a greenhouse at dawn"
        auto: false
    hidden-moment:
      title: Hidden moment
      hint: Needs restricted generator tier.
      rating: restricted
      order: 20
      unlock:
        when: "false"
`,
  );
  await storage.writeAtomic(
    "characters/npc1/card.md",
    `---
identity:
  id: npc1
  name: Aria
  visual: "silver hair, green coat"
tags: []
constraints:
  motives: []
  bottom_lines: []
  taboos: []
lod: principal
---
Aria persona.
`,
  );
}

export async function seedGalleryEngineRoot(storage: StoragePort): Promise<void> {
  const { seedE2eAuthored } = await import("../e2e/fixture.ts");
  await seedE2eAuthored(storage);
  await seedGalleryAuthored(storage);
}
