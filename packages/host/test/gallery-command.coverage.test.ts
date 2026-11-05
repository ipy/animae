import { describe, expect, test } from "bun:test";
import { createGalleryCommand } from "../src/gallery-command.ts";
import { createHostI18n } from "../src/i18n/host-i18n.ts";
import type { HostCommandApi } from "../src/types.ts";

type GalleryItem = {
  id: string;
  kind: "preset";
  title: string;
  order: number;
  rating: string;
  available: boolean;
  unlocked: boolean;
  characters: string[];
  tags: string[];
  caption?: string;
  hint?: string;
  job?: { state: string; progress?: number };
  image?: { path: string; width: number; height: number; mime: string };
};

function buildGallery(overrides: Partial<ReturnType<typeof baseGallery>> = {}) {
  return { ...baseGallery(), ...overrides };
}

function baseGallery() {
  const item: GalleryItem = {
    id: "a",
    kind: "preset",
    title: "Alpha",
    order: 1,
    rating: "general",
    available: true,
    unlocked: false,
    characters: [],
    tags: [],
    hint: "secret",
    job: { state: "running", progress: 0.5 },
  };
  return {
    list: async () => [item],
    get: async (id: string) => (id === "a" ? item : undefined),
    capture: async () => ({ item: "cap-1", job: "job-1" }),
    render: async () => ({ job: "job-2" }),
    cancel: async () => true,
    remove: async () => {},
    pin: async () => {},
    unlock: async () => {},
    image: async (id: string) =>
      id === "a"
        ? { ref: { path: "/tmp/x.png", id: "img", mime: "image/png", width: 1, height: 1, bytes: 1 }, bytes: new Uint8Array([1]) }
        : undefined,
    jobs: () => [{ id: "job-1", item: "a", state: "running", progress: 0.25 }],
    ratings: () => [{ id: "general", label: "General", available: false }],
    subscribe: () => () => {},
  };
}

function api(gallery = buildGallery(), extra: Partial<HostCommandApi> = {}): HostCommandApi {
  const i18n = createHostI18n("en");
  const notes: string[] = [];
  return {
    engine: { gallery } as unknown as HostCommandApi["engine"],
    viewer: "player",
    actor: "player",
    sceneId: () => undefined,
    startScene: async () => "s",
    endScene: async () => {},
    notify: (t) => notes.push(String(t)),
    openOverlay: () => {},
    closeOverlay: () => {},
    setMouseCapture: () => {},
    locale: () => "en",
    t: (k, p) => i18n.t(k, p),
    openFile: async (path) => {
      notes.push(`open:${path}`);
    },
    ...extra,
  };
}

describe("gallery command subcommands", () => {
  const cmd = createGalleryCommand();

  test("list with filters and locked suffix", async () => {
    const out = await cmd.run(["list", "--all", "--rating=general"], api());
    expect(out).toContain("Alpha");
    expect(out).toContain("general");
    expect(out).toContain("50%");
  });

  test("list empty after rating filter", async () => {
    const out = await cmd.run(["list", "--rating=nope"], api());
    expect(out?.toLowerCase()).toContain("empty");
  });

  test("show prints fields for locked item", async () => {
    const out = await cmd.run(["show", "a"], api());
    expect(out).toContain("Alpha");
    expect(out).toContain("secret");
  });

  test("show warns on missing id or item", async () => {
    const notes: string[] = [];
    const notify = (t: string) => notes.push(String(t));
    await cmd.run(["show"], api(buildGallery(), { notify }));
    expect(notes.some((n) => n.toLowerCase().includes("usage"))).toBe(true);
    await cmd.run(["show", "missing"], api(buildGallery(), { notify }));
    expect(notes.some((n) => n.toLowerCase().includes("gallery entry"))).toBe(true);
  });

  test("capture and render", async () => {
    expect(await cmd.run(["capture", "focus", "here"], api())).toContain("cap-1");
    expect(await cmd.run(["render", "a", "--reroll"], api())).toContain("job-2");
    const notes: string[] = [];
    await cmd.run(["render"], api(undefined, { notify: (t) => notes.push(String(t)) }));
    expect(notes.some((n) => n.toLowerCase().includes("usage"))).toBe(true);
  });

  test("cancel picks active job", async () => {
    expect(await cmd.run(["cancel"], api())).toContain("job-1");
    const notes: string[] = [];
    await cmd.run(["cancel"], api(buildGallery({ jobs: () => [], cancel: async () => false }), { notify: (t) => notes.push(String(t)) }));
    expect(notes.some((n) => n.toLowerCase().includes("no") && n.toLowerCase().includes("job"))).toBe(true);
  });

  test("remove pin unpin unlock", async () => {
    expect(await cmd.run(["remove", "a"], api())).toMatch(/removed/i);
    expect(await cmd.run(["pin", "a"], api())).toMatch(/pinned/i);
    expect(await cmd.run(["unpin", "a"], api())).toMatch(/unpinned/i);
    expect(await cmd.run(["unlock", "a"], api())).toMatch(/unlock/i);
  });

  test("open uses openFile hook", async () => {
    const notes: string[] = [];
    const out = await cmd.run(
      ["open", "a"],
      api(buildGallery(), {
        notify: (t) => notes.push(String(t)),
        openFile: async (path) => {
      notes.push(`open:${path}`);
    },
      }),
    );
    expect(out).toMatch(/opened/i);
    expect(notes.some((n) => n.includes("open:/tmp/x.png"))).toBe(true);
  });

  test("open prints path when no opener", async () => {
    const bare = createGalleryCommand();
    const path = await bare.run(["open", "a"], api(undefined, { openFile: undefined }));
    expect(path).toBe("/tmp/x.png");
  });

  test("jobs and ratings listings", async () => {
    expect(await cmd.run(["jobs"], api())).toContain("25%");
    expect(await cmd.run(["ratings"], api())).toContain("General");
    expect(await cmd.run(["jobs"], api(buildGallery({ jobs: () => [] })))).toMatch(/no gallery jobs/i);
    expect(await cmd.run(["ratings"], api(buildGallery({ ratings: () => [] })))).toMatch(/no rating/i);
  });

  test("show includes image metadata when present", async () => {
    const item: GalleryItem = {
      id: "img",
      kind: "preset",
      title: "Pic",
      order: 1,
      rating: "general",
      available: true,
      unlocked: true,
      characters: [],
      tags: [],
      image: { path: "/a/b.png", width: 100, height: 50, mime: "image/png" },
    };
    const gallery = buildGallery({
      list: async () => [item],
      get: async (id: string) => (id === "img" ? item : undefined),
    });
    const out = await cmd.run(["show", "img"], api(gallery));
    expect(out).toContain("100x50");
    expect(out).toContain("image/png");
  });

  test("usage warnings for remove pin open unlock", async () => {
    const notes: string[] = [];
    const notify = (t: string) => notes.push(String(t));
    const g = buildGallery();
    await cmd.run(["remove"], api(g, { notify }));
    await cmd.run(["pin"], api(g, { notify }));
    await cmd.run(["open"], api(g, { notify }));
    await cmd.run(["unlock"], api(g, { notify }));
    expect(notes.filter((n) => n.toLowerCase().includes("usage")).length).toBeGreaterThanOrEqual(4);
  });

  test("open warns when image missing", async () => {
    const notes: string[] = [];
    const gallery = buildGallery({ image: async () => undefined });
    await cmd.run(["open", "a"], api(gallery, { notify: (t) => notes.push(String(t)) }));
    expect(notes.some((n) => n.toLowerCase().includes("image"))).toBe(true);
  });

  test("unknown subcommand hints help", async () => {
    const notes: string[] = [];
    await cmd.run(["frobnicate"], api(undefined, { notify: (t, l) => notes.push(`${l}:${t}`) }));
    expect(notes.some((n) => n.toLowerCase().includes("unknown"))).toBe(true);
    expect(notes.some((n) => n.toLowerCase().includes("help") || n.toLowerCase().includes("gallery"))).toBe(true);
  });
});
