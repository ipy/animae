import { test, expect } from "bun:test";
import { validateGalleryAuthored } from "../../src/authored/gallery-validate.ts";
import { authoredWithGallery } from "../helpers/gallery-authored.ts";

test("validateGalleryAuthored reports invalid CEL on each rating when expression", async () => {
  const authored = authoredWithGallery({
    defaultRating: "general",
    ratings: {
      general: { when: "true", label: "G" },
      restricted: { when: "1 + ", label: "R" },
    },
    entries: {},
  });
  const issues = await validateGalleryAuthored(authored, async () => true);
  expect(issues.some((i) => i.path === "gallery.ratings.restricted.when" && i.message.length > 0)).toBe(true);
});
