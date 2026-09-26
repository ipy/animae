import { describe, expect, test } from "bun:test";
import { SessionHost } from "@animae/host";
import { parseGalleryImagePath, serveGalleryImageRequest, defaultGalleryImagePolicy } from "../src/server/gallery-image.ts";
import type { Engine } from "@animae/engine";

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
]);

function engineWithImage(): Engine {
  return {
    world: { now: () => ({ day: 1, minute: 0 }) },
    query: () => ({}),
    timeline: { current: () => ({ name: "main" }) },
    scene: { start: async () => "s", end: async () => {}, turn: async function* () {} },
    mods: () => null,
    on: () => () => {},
    gallery: {
      generatorAvailable: () => true,
      ratings: () => [],
      list: async () => [],
      get: async (id: string) =>
        id === "shot-a"
          ? {
              id: "shot-a",
              kind: "preset",
              title: "A",
              order: 1,
              rating: "general",
              available: true,
              unlocked: true,
              characters: [],
              tags: [],
              image: {
                id: "imgdeadbeef",
                path: "gallery/images/x.png",
                mime: "image/png",
                width: 1,
                height: 1,
                bytes: PNG.length,
              },
            }
          : undefined,
      unlock: async () => {
        throw new Error("no");
      },
      capture: async () => ({ item: "x", job: "y" }),
      render: async () => ({ job: "y" }),
      cancel: async () => false,
      remove: async () => {},
      pin: async () => {},
      image: async (id: string) =>
        id === "shot-a"
          ? {
              bytes: new Uint8Array(PNG),
              ref: {
                id: "imgdeadbeef",
                path: "gallery/images/x.png",
                mime: "image/png",
                width: 1,
                height: 1,
                bytes: PNG.length,
              },
            }
          : undefined,
      jobs: () => [],
      subscribe: () => () => {},
    },
  } as unknown as Engine;
}

describe("gallery image HTTP route", () => {
  test("parseGalleryImagePath rejects traversal", () => {
    expect(parseGalleryImagePath("/api/gallery/image/../secret")).toBeUndefined();
  });

  test("serves bytes with immutable cache for default rating", async () => {
    const host = new SessionHost({ engine: engineWithImage() });
    const url = new URL("http://127.0.0.1/api/gallery/image/shot-a?v=imgdeadbeef");
    const res = await serveGalleryImageRequest(new Request(url.href), url, host, defaultGalleryImagePolicy("general"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("immutable");
    expect(res.headers.get("content-type")).toBe("image/png");
    host.dispose();
  });

  test("304 when ETag matches", async () => {
    const host = new SessionHost({ engine: engineWithImage() });
    const url = new URL("http://127.0.0.1/api/gallery/image/shot-a?v=imgdeadbeef");
    const req = new Request(url.href, { headers: { "if-none-match": '"imgdeadbeef"' } });
    const res = await serveGalleryImageRequest(req, url, host, defaultGalleryImagePolicy("general"));
    expect(res.status).toBe(304);
    host.dispose();
  });

  test("404 for locked entry", async () => {
    const eng = engineWithImage();
    const locked = eng.gallery;
    eng.gallery = {
      ...locked,
      get: async () => ({
        id: "shot-a",
        kind: "preset",
        title: "A",
        order: 1,
        rating: "general",
        available: true,
        unlocked: false,
        characters: [],
        tags: [],
      }),
      image: locked.image,
    };
    const host = new SessionHost({ engine: eng });
    const url = new URL("http://127.0.0.1/api/gallery/image/shot-a?v=imgdeadbeef");
    const res = await serveGalleryImageRequest(new Request(url.href), url, host, defaultGalleryImagePolicy("general"));
    expect(res.status).toBe(404);
    host.dispose();
  });
});
