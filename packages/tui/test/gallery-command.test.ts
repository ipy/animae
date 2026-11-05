import { describe, expect, test } from "bun:test";
import { runGalleryCommand } from "../src/commands/gallery.ts";
import { createTuiFakeEngine } from "./helpers/fake-engine.ts";
import type { GalleryItemView } from "@animae/engine";
import { createTestCommandApi } from "./helpers/command-api-test.ts";

const sampleItem: GalleryItemView = {
  id: "g1",
  kind: "preset",
  title: "Portrait",
  order: 1,
  rating: "general",
  available: true,
  unlocked: true,
  characters: [],
  tags: [],
  caption: "A portrait",
};

describe("gallery command", () => {
  test("opens overlay with no args", async () => {
    let opened: string | undefined;
    const { api: a } = createTestCommandApi();
    a.openOverlay = (k) => (opened = k);
    await runGalleryCommand([], a);
    expect(opened).toBe("gallery");
  });

  test("list and show subcommands", async () => {
    const engine = createTuiFakeEngine({
      gallery: {
        ...createTuiFakeEngine().gallery,
        list: async () => [sampleItem],
        get: async (id) => (id === "g1" ? sampleItem : undefined),
      },
    });
    const { api: a, notes } = createTestCommandApi({}, engine);
    const listed = await runGalleryCommand(["list"], a);
    expect(listed).toContain("g1");
    expect(listed).toContain("Portrait");
    const shown = await runGalleryCommand(["show", "g1"], a);
    expect(shown).toContain("Portrait");
    await runGalleryCommand(["show"], a);
    expect(notes[0]?.text).toContain("command.gallery.show_usage");
    await runGalleryCommand(["show", "missing"], a);
    expect(notes[1]?.text).toContain("command.gallery.not_found");
  });

  test("empty list and unknown subcommand opens panel", async () => {
    const engine = createTuiFakeEngine({
      gallery: {
        ...createTuiFakeEngine().gallery,
        list: async () => [],
      },
    });
    const { api: a } = createTestCommandApi({}, engine);
    const empty = await runGalleryCommand(["list"], a);
    expect(empty).toBe("command.gallery.list_empty");
    let opened = false;
    a.openOverlay = () => {
      opened = true;
    };
    await runGalleryCommand(["capture"], a);
    expect(opened).toBe(true);
  });

  test("surfaces gallery errors as warnings", async () => {
    const engine = createTuiFakeEngine({
      gallery: {
        ...createTuiFakeEngine().gallery,
        list: async () => {
          throw new Error("gallery down");
        },
      },
    });
    const { api: a, notes } = createTestCommandApi({}, engine);
    await runGalleryCommand(["list"], a);
    expect(notes[0]?.text).toContain("gallery down");
  });
});
