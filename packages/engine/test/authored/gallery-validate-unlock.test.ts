import { describe, expect, test } from "bun:test";
import { validateGalleryAuthored } from "../../src/authored/gallery-validate.ts";
import { minimalAuthored } from "../timeline/fixture.ts";
import type { Authored } from "../../src/schema/authored.ts";

function withGallery(gallery: unknown): Authored {
  return { ...minimalAuthored(), config: { ...minimalAuthored().config, gallery: gallery as Authored["config"]["gallery"] } };
}

describe("validateGalleryAuthored unlock and assets", () => {
  test("unlock hint requirement when unlock.when is set", async () => {
    const issues = await validateGalleryAuthored(
      withGallery({
        defaultRating: "general",
        ratings: { general: { when: "true", label: "G" } },
        entries: {
          e1: { title: "A", rating: "general", characters: ["npc1"], unlock: { when: "true" } },
        },
      }),
      async () => true,
    );
    expect(issues.some((i) => i.path.includes("hint") && i.message.includes("unlock.when"))).toBe(true);
  });

  test("invalid unlock CEL is reported", async () => {
    const issues = await validateGalleryAuthored(
      withGallery({
        defaultRating: "general",
        ratings: { general: { when: "true", label: "G" } },
        entries: {
          e1: { title: "A", rating: "general", characters: ["npc1"], hint: "find it", unlock: { when: "(" } },
        },
      }),
      async () => true,
    );
    expect(issues.some((i) => i.path.includes("unlock.when"))).toBe(true);
  });

  test("unsafe and missing image paths", async () => {
    const issues = await validateGalleryAuthored(
      withGallery({
        defaultRating: "general",
        ratings: { general: { when: "true", label: "G" } },
        entries: {
          e1: { title: "A", rating: "general", characters: ["npc1"], image: { src: "/absolute/escape.png" } },
          e2: { title: "B", rating: "general", characters: ["npc1"], image: { src: "art/missing.png" } },
        },
      }),
      async (path) => path !== "art/missing.png",
    );
    expect(issues.some((i) => i.message.includes("relative path"))).toBe(true);
    expect(issues.some((i) => i.message.includes("missing shipped art"))).toBe(true);
  });
});
