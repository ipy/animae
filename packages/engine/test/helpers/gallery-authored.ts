import { GalleryConfigSchema } from "../../src/schema/gallery.ts";
import type { Authored } from "../../src/schema/authored.ts";
import { minimalAuthored } from "../timeline/fixture.ts";

/** Authored config with a gallery blob (runtime-validated by validateGalleryAuthored, not zod-parsed here). */
export function authoredWithGallery(gallery: unknown): Authored {
  const base = minimalAuthored();
  return {
    ...base,
    config: {
      ...base.config,
      gallery: gallery as Authored["config"]["gallery"],
    },
  };
}

/** Gallery config that must satisfy GalleryConfigSchema (valid CEL, etc.). */
export function authoredWithParsedGallery(gallery: unknown): Authored {
  const base = minimalAuthored();
  return {
    ...base,
    config: {
      ...base.config,
      gallery: GalleryConfigSchema.parse(gallery),
    },
  };
}
