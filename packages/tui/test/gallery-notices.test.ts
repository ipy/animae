import { describe, expect, test } from "bun:test";
import type { GalleryItemView } from "@animae/engine";
import { createHostI18n, galleryNoticeToast } from "@animae/host";

function view(id: string, over: Partial<GalleryItemView> = {}): GalleryItemView {
  return {
    id,
    kind: "preset",
    title: `Title ${id}`,
    order: 1,
    rating: "general",
    available: true,
    unlocked: true,
    characters: [],
    tags: [],
    ...over,
  };
}

describe("TUI gallery notice toasts (shared host helper)", () => {
  test("masked mature titles stay generic in en and fr", async () => {
    for (const locale of ["en", "fr"] as const) {
      const hostT = createHostI18n(locale);
      const t = (key: string, params?: Record<string, string | number>) =>
        hostT.t(key, params, { ns: "host" });
      const toast = await galleryNoticeToast(
        { type: "unlocked", item: "night" },
        {
          locale,
          getItem: async (id) => (id === "night" ? view("night", { rating: "mature", title: "Secret" }) : undefined),
          maskTitle: (i) => i.rating !== "general",
          t,
        },
      );
      expect(toast?.text).toBeDefined();
      expect(toast!.text).not.toContain("Secret");
      expect(toast!.text).not.toContain("night");
    }
  });

  test("job failure toast uses localized reason, not a bare code", async () => {
    const hostT = createHostI18n("en");
    const t = (key: string, params?: Record<string, string | number>) =>
      hostT.t(key, params, { ns: "host" });
    const toast = await galleryNoticeToast(
      {
        type: "job",
        job: {
          id: "j1",
          item: "a",
          state: "failed",
          error: { code: "GALLERY_GENERATION_FAILED", message: "x" },
        },
      },
      {
        locale: "en",
        getItem: async () => view("a", { title: "Alpha" }),
        t,
      },
    );
    expect(toast?.level).toBe("error");
    expect(toast!.text).toContain("Alpha");
    expect(toast!.text).not.toMatch(/^\s*GALLERY_/);
  });
});
