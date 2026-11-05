import { describe, expect, test } from "bun:test";
import { localizeValue } from "@animae/i18n";
import type { GalleryItemView, GalleryNotice } from "@animae/engine";
import { SessionHost, type SessionHostOptions } from "../src/session-host.ts";
import { createHostI18n } from "../src/i18n/host-i18n.ts";

function view(id: string, over: Partial<GalleryItemView> = {}): GalleryItemView {
  return {
    id,
    kind: "preset",
    title: `Title of ${id}`,
    order: 1,
    rating: "general",
    available: true,
    unlocked: true,
    characters: [],
    tags: [],
    ...over,
  };
}

function setup(opts: {
  views?: Record<string, GalleryItemView>;
  getThrows?: boolean;
  notices?: SessionHostOptions["galleryNotices"];
  uiLocale?: string;
}) {
  let emit: (n: GalleryNotice) => void = () => {};
  const gets: Array<{ id: string; locale?: string }> = [];
  const engine = {
    gallery: {
      subscribe: (fn: (n: GalleryNotice) => void) => {
        emit = fn;
        return () => {};
      },
      get: async (id: string, o?: { locale?: string }) => {
        gets.push({ id, locale: o?.locale });
        if (opts.getThrows) throw new Error("boom");
        return opts.views?.[id];
      },
    },
    on: () => () => {},
    query: () => undefined,
    world: { now: () => ({ day: 1, minute: 0 }) },
    scene: { current: () => undefined },
  } as unknown as SessionHostOptions["engine"];
  const host = new SessionHost({ engine, uiLocale: opts.uiLocale ?? "en", galleryNotices: opts.notices });
  const toasts: Array<{ level: string; text: string }> = [];
  host.setStreamCallbacks({ onToast: (level, text) => toasts.push({ level, text }) });
  const i18n = createHostI18n(opts.uiLocale ?? "en");
  const systemLines = () =>
    host.ui.transcript
      .filter((e) => e.kind === "system")
      .map((e) => String(localizeValue(e.text, (k, p) => i18n.t(k, p, { ns: "host" }))));
  const flush = () => new Promise((r) => setTimeout(r, 0));
  return { host, emit: (n: GalleryNotice) => emit(n), toasts, systemLines, flush, gets };
}

describe("gallery notices in the host", () => {
  test("an unlock names the entry by its title in the viewer's language, never by its id", async () => {
    const s = setup({ views: { dawn: view("dawn", { title: "Greenhouse dawn" }) }, uiLocale: "fr" });
    s.emit({ type: "unlocked", item: "dawn" });
    await s.flush();
    expect(s.gets[0]).toEqual({ id: "dawn", locale: "fr" });
    expect(s.toasts).toHaveLength(1);
    expect(s.toasts[0]!.text).toContain("Greenhouse dawn");
    expect(s.toasts[0]!.text).not.toContain("dawn,");
    const lines = s.systemLines();
    expect(lines.at(-1)).toContain("Greenhouse dawn");
  });

  test("a masked entry stays generic: no title in the toast or the transcript", async () => {
    const s = setup({
      views: { night: view("night", { title: "Secret title", rating: "mature" }) },
      notices: { maskTitle: (i) => i.rating !== "general" },
    });
    s.emit({ type: "unlocked", item: "night" });
    s.emit({ type: "job", job: { id: "j1", item: "night", state: "done" } });
    await s.flush();
    const all = [...s.toasts.map((t) => t.text), ...s.systemLines()].join("\n");
    expect(all).not.toContain("Secret title");
    expect(all).not.toContain("night");
    expect(s.toasts).toHaveLength(2);
  });

  test("an unknown entry or a failing lookup falls back to the generic notice", async () => {
    for (const s of [setup({ views: {} }), setup({ getThrows: true })]) {
      s.emit({ type: "unlocked", item: "ghost" });
      await s.flush();
      expect(s.toasts).toHaveLength(1);
      expect(s.toasts[0]!.text).not.toContain("ghost");
      expect(s.toasts[0]!.text.length).toBeGreaterThan(5);
    }
  });

  test("job results: done names the title, failure carries the code", async () => {
    const s = setup({ views: { a: view("a", { title: "Alpha" }) } });
    s.emit({ type: "job", job: { id: "j", item: "a", state: "done" } });
    s.emit({ type: "job", job: { id: "j", item: "a", state: "failed", error: { code: "GALLERY_GENERATION_FAILED", message: "x" } } });
    s.emit({ type: "job", job: { id: "j", item: "a", state: "rendering" } });
    await s.flush();
    expect(s.toasts.map((t) => t.level)).toEqual(["info", "error"]);
    expect(s.toasts[0]!.text).toContain("Alpha");
    expect(s.toasts[1]!.text).toContain("Alpha");
    expect(s.toasts[1]!.text).toContain("Alpha");
    expect(s.toasts[1]!.text.toLowerCase()).toContain("generation failed");
  });

  test("toasts can be left to the client while the transcript still records the unlock", async () => {
    const s = setup({ views: { a: view("a", { title: "Alpha" }) }, notices: { toasts: false } });
    s.emit({ type: "unlocked", item: "a" });
    s.emit({ type: "job", job: { id: "j", item: "a", state: "done" } });
    await s.flush();
    expect(s.toasts).toHaveLength(0);
    expect(s.systemLines().at(-1)).toContain("Alpha");
  });
});
