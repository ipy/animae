import { describe, expect, test } from "bun:test";
import { validateGalleryAuthored } from "../../src/authored/gallery-validate.ts";
import type { Authored } from "../../src/schema/authored.ts";
import { minimalAuthored } from "../timeline/fixture.ts";

function authored(gallery: unknown): Authored {
  const base = minimalAuthored();
  const config: Authored["config"] = { ...base.config, gallery: gallery as Authored["config"]["gallery"] };
  return { ...base, config };
}

describe("validateGalleryAuthored", () => {
  test("invalid gallery schema produces animae.yaml paths", async () => {
    const issues = await validateGalleryAuthored(authored({ entries: "not-an-object" }), async () => false);
    expect(issues.some((i) => i.file === "animae.yaml" && i.path.startsWith("gallery."))).toBe(true);
  });

  test("unknown rating, character, and location on a valid entry", async () => {
    const issues = await validateGalleryAuthored(
      authored({
        defaultRating: "general",
        ratings: { general: { when: "true", label: "G" } },
        entries: {
          e1: {
            title: "Scene",
            rating: "missing",
            characters: ["nobody"],
            location: "nowhere",
          },
        },
      }),
      async () => false,
    );
    expect(issues.some((i) => i.path.includes("rating") && i.message.includes("missing"))).toBe(true);
    expect(issues.some((i) => i.message.includes("nobody"))).toBe(true);
    expect(issues.some((i) => i.message.includes("nowhere"))).toBe(true);
  });

  test("invalid rating when expression is reported", async () => {
    const issues = await validateGalleryAuthored(
      authored({
        defaultRating: "general",
        ratings: { bad: { when: "(", label: "X" } },
        entries: {},
      }),
      async () => false,
    );
    expect(issues.some((i) => i.path.includes("gallery.ratings.bad.when"))).toBe(true);
  });
});
