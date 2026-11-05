import { describe, expect, test } from "bun:test";
import type { GalleryItemView, GalleryService } from "@animae/engine";
import type { RunTuiOptions } from "../src/types.ts";
import { createTuiFakeEngineControls } from "./helpers/fake-engine.ts";
import { KEYS, mountLiveTui } from "./helpers/live-app-harness.tsx";
import { waitMs } from "./helpers/ink-harness.ts";

function entry(id: string, title: string, over: Partial<GalleryItemView> = {}): GalleryItemView {
  return { id, kind: "captured", title, order: 0, rating: "general", available: true, unlocked: true, characters: [], tags: [], ...over };
}

const selectedRow = (text: string): string | undefined => text.split("\n").find((line) => line.includes("▸"));

type Tui = ReturnType<typeof mountLiveTui>;

/** The TUI on a fake engine whose gallery serves `items` and records the calls the keys make. */
function setup(
  items: GalleryItemView[],
  over: Partial<GalleryService> = {},
  options: Partial<Omit<RunTuiOptions, "engine">> = {},
): { tui: Tui; calls: string[] } {
  const calls: string[] = [];
  const base = createTuiFakeEngineControls().engine.gallery;
  const { engine } = createTuiFakeEngineControls({
    gallery: {
      ...base,
      list: async () => items,
      pin: async (id, pinned) => {
        calls.push(`pin ${id} ${pinned}`);
      },
      remove: async (id) => {
        calls.push(`remove ${id}`);
      },
      render: async (id) => {
        calls.push(`render ${id}`);
        return { job: "job_1" };
      },
      cancel: async (job) => {
        calls.push(`cancel ${job}`);
        return true;
      },
      capture: async () => {
        calls.push("capture");
        return { item: "new", job: "job_2" };
      },
      ...over,
    },
  });
  return { tui: mountLiveTui({ engine, scene: { sceneId: "scn_0001" }, ...options }), calls };
}

async function openGallery(tui: Tui): Promise<void> {
  await waitMs(60);
  await tui.type(":gallery");
  await tui.press(KEYS.enter);
  expect(await tui.pollUntil((t) => t.includes("CG Gallery"), 2000)).toBe(true);
}

describe("gallery overlay keys", () => {
  test("the selection stays on the list however often the arrow is pressed", async () => {
    const { tui } = setup([entry("g1", "Harbour"), entry("g2", "Lantern")]);
    await openGallery(tui);
    expect(await tui.pollUntil((t) => t.includes("Harbour"), 2000)).toBe(true);
    expect(selectedRow(tui.getText())).toContain("Harbour");

    await tui.press(...Array<string>(6).fill(KEYS.down));
    expect(selectedRow(tui.getText())).toContain("Lantern");
    // one step back is the first entry again: the overshoot was not remembered
    await tui.press(KEYS.up);
    expect(selectedRow(tui.getText())).toContain("Harbour");
    await tui.press(KEYS.escape);
    await tui.finish(60);
  });

  test("p pins a captured entry, unpins a pinned one and leaves shipped entries alone", async () => {
    const { tui, calls } = setup([
      entry("a", "Alpha"),
      entry("b", "Bravo", { pinned: true }),
      entry("c", "Charlie", { kind: "preset" }),
    ]);
    await openGallery(tui);
    await tui.press("p");
    await waitMs(60);
    expect(calls).toEqual(["pin a true"]);
    await tui.press(KEYS.down, "p");
    await waitMs(60);
    expect(calls).toEqual(["pin a true", "pin b false"]);
    await tui.press(KEYS.down, "p");
    await waitMs(60);
    expect(calls).toEqual(["pin a true", "pin b false"]);
    await tui.press(KEYS.escape);
    await tui.finish(60);
  });

  test("d asks first and removes the entry on the second press", async () => {
    const { tui, calls } = setup([entry("a", "Alpha")]);
    await openGallery(tui);
    await tui.press("d");
    await waitMs(60);
    expect(calls).toEqual([]);
    await tui.press("d");
    await waitMs(60);
    expect(calls).toEqual(["remove a"]);
    await tui.press(KEYS.escape);
    await tui.finish(60);
  });

  test("d never removes a shipped entry", async () => {
    const { tui, calls } = setup([entry("p", "Preset", { kind: "preset" })]);
    await openGallery(tui);
    await tui.press("d", "d");
    await waitMs(60);
    expect(calls).toEqual([]);
    await tui.press(KEYS.escape);
    await tui.finish(60);
  });

  test("moving to another entry withdraws the question, so the next d asks again", async () => {
    const { tui, calls } = setup([entry("a", "Alpha"), entry("b", "Bravo")]);
    await openGallery(tui);
    await tui.press("d", KEYS.down, "d");
    await waitMs(60);
    expect(calls).toEqual([]);
    await tui.press("d");
    await waitMs(60);
    expect(calls).toEqual(["remove b"]);
    await tui.press(KEYS.escape);
    await tui.finish(60);
  });

  test("closing the list withdraws the question, so a later d asks again", async () => {
    const { tui, calls } = setup([entry("a", "Alpha")]);
    await openGallery(tui);
    await tui.press("d");
    await tui.press(KEYS.escape);
    expect(await tui.pollUntil((t) => !t.includes("CG Gallery"), 2000)).toBe(true);
    await openGallery(tui);
    await tui.press("d");
    await waitMs(60);
    expect(calls).toEqual([]);
    await tui.press("d");
    await waitMs(60);
    expect(calls).toEqual(["remove a"]);
    await tui.press(KEYS.escape);
    await tui.finish(60);
  });

  test("a removal the engine refuses is reported in the transcript", async () => {
    const { tui } = setup([entry("a", "Alpha")], {
      remove: async () => {
        throw new Error("the gallery is read-only");
      },
    });
    await openGallery(tui);
    await tui.press("d", "d");
    await waitMs(80);
    await tui.press(KEYS.escape);
    expect(await tui.pollUntil((t) => t.includes("the gallery is read-only"), 2000)).toBe(true);
    await tui.finish(60);
  });

  test("Enter reveals the title of a masked entry", async () => {
    const { tui } = setup([entry("p1", "Moonlit", { kind: "preset" })], {}, {
      galleryPresentation: () => ({ blur: true }),
    });
    await openGallery(tui);
    expect(await tui.pollUntil((t) => t.includes("Restricted entry"), 2000)).toBe(true);
    expect(tui.getText()).not.toContain("Moonlit");
    await tui.press(KEYS.enter);
    expect(await tui.pollUntil((t) => t.includes("Moonlit"), 2000)).toBe(true);
    await tui.press(KEYS.escape);
    await tui.finish(60);
  });

  test("r renders the highlighted entry, c captures, x cancels the job that is still running", async () => {
    const { tui, calls } = setup([entry("a", "Alpha")], {
      jobs: () => [
        { id: "job_done", item: "a", state: "done" },
        { id: "job_live", item: "a", state: "rendering", progress: 0.4 },
      ],
    });
    await openGallery(tui);
    await tui.press("r");
    await waitMs(60);
    await tui.press("c");
    await waitMs(60);
    await tui.press("x");
    await waitMs(60);
    expect(calls).toEqual(["render a", "capture", "cancel job_live"]);
    await tui.press(KEYS.escape);
    await tui.finish(60);
  });

  test("o opens the image through the host, or prints its path, and says when there is none", async () => {
    const image: Awaited<ReturnType<GalleryService["image"]>> = {
      bytes: new Uint8Array(),
      ref: { id: "img1", path: "/data/gallery/a.png", mime: "image/png", width: 64, height: 48, bytes: 0 },
    };
    const opened: string[] = [];
    const withHost = setup([entry("a", "Alpha")], { image: async () => image }, { openFile: (path) => void opened.push(path) });
    await openGallery(withHost.tui);
    await withHost.tui.press("o");
    await waitMs(80);
    expect(opened).toEqual(["/data/gallery/a.png"]);
    await withHost.tui.press(KEYS.escape);
    await withHost.tui.finish(60);

    const printing = setup([entry("a", "Alpha"), entry("b", "Bravo")], {
      image: async (id) => (id === "a" ? image : undefined),
    });
    await openGallery(printing.tui);
    await printing.tui.press("o");
    await waitMs(80);
    await printing.tui.press(KEYS.down, "o");
    await waitMs(80);
    await printing.tui.press(KEYS.escape);
    expect(await printing.tui.pollUntil((t) => t.includes("/data/gallery/a.png") && t.includes("No image available for this entry."), 2000)).toBe(true);
    await printing.tui.finish(60);
  });
});
