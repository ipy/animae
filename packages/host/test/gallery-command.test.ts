import { describe, expect, test } from "bun:test";
import { AnimaeError } from "@animae/engine";
import { createGalleryCommand } from "../src/gallery-command.ts";
import { createHostI18n } from "../src/i18n/host-i18n.ts";
import type { HostCommandApi } from "../src/types.ts";

function api(overrides: Partial<HostCommandApi> = {}): HostCommandApi {
  const i18n = createHostI18n("en");
  const gallery = {
    generatorAvailable: () => true,
    ratings: () => [{ id: "general", label: "General", available: true }],
    list: async () => [
      {
        id: "a",
        kind: "preset" as const,
        title: "Alpha",
        order: 1,
        rating: "general",
        available: true,
        unlocked: true,
        characters: [],
        tags: [],
      },
    ],
    get: async (id: string) =>
      id === "a"
        ? {
            id: "a",
            kind: "preset" as const,
            title: "Alpha",
            order: 1,
            rating: "general",
            available: true,
            unlocked: true,
            characters: [],
            tags: [],
          }
        : undefined,
    unlock: async () => {
      throw new AnimaeError("GALLERY_LOCKED", "locked");
    },
    capture: async () => ({ item: "cap-1", job: "job-1" }),
    render: async () => ({ job: "job-2" }),
    cancel: async () => true,
    remove: async () => {},
    pin: async () => {},
    image: async () => undefined,
    jobs: () => [],
    subscribe: () => () => {},
  };
  return {
    engine: { gallery } as unknown as HostCommandApi["engine"],
    viewer: "player",
    actor: "player",
    sceneId: () => undefined,
    startScene: async () => "s",
    endScene: async () => {},
    notify: () => {},
    openOverlay: () => {},
    closeOverlay: () => {},
    setMouseCapture: () => {},
    locale: () => "en",
    t: (k, p) => i18n.t(k, p),
    ...overrides,
  };
}

describe(":gallery command", () => {
  const cmd = createGalleryCommand();

  test("list prints rows", async () => {
    const out = await cmd.run(["list"], api());
    expect(out).toContain("a");
    expect(out).toContain("Alpha");
  });

  test("maps GALLERY_LOCKED to localized text", async () => {
    const notes: string[] = [];
    try {
      await cmd.run(["unlock", "missing"], api({ notify: (t) => notes.push(String(t)) }));
    } catch {
      /* withGallery rethrows after notify */
    }
    expect(notes.some((n) => n.includes("GALLERY_LOCKED"))).toBe(true);
    expect(notes.some((n) => n.toLowerCase().includes("lock"))).toBe(true);
  });

  test("ratings subcommand", async () => {
    const out = await cmd.run(["ratings"], api());
    expect(out).toContain("general");
  });
});
