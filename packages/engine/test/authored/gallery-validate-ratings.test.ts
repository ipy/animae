import { describe, expect, test } from "bun:test";
import { validateGalleryAuthored } from "../../src/authored/gallery-validate.ts";
import { minimalAuthored } from "../timeline/fixture.ts";
import type { Authored } from "../../src/schema/authored.ts";

function withGallery(gallery: unknown): Authored {
  return { ...minimalAuthored(), config: { ...minimalAuthored().config, gallery: gallery as Authored["config"]["gallery"] } };
}

describe("validateGalleryAuthored ratings loop", () => {
  test("invalid rating CEL and duplicate entry id in config object", async () => {
    const issues = await validateGalleryAuthored(
      withGallery({
        defaultRating: "general",
        ratings: {
          general: { when: "true", label: "G" },
          bad: { when: "(", label: "X" },
        },
        entries: {
          dup: { title: "One", rating: "general", characters: ["npc1"] },
        },
      }),
      async () => true,
    );
    expect(issues.some((i) => i.path.includes("gallery.ratings.bad.when"))).toBe(true);
  });
});
