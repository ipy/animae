import type { GalleryItemView } from "@animae/engine";
import type { SessionHost } from "@animae/host";

export type GalleryImageCachePolicy = { cache: "immutable" | "no-store" };

export type GalleryImagePolicyFn = (item: GalleryItemView) => GalleryImageCachePolicy;

const IMMUTABLE_HEADERS =
  "private, max-age=31536000, immutable" as const;
const NO_STORE_HEADERS = "no-store" as const;

const GALLERY_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

export function parseGalleryImagePath(pathname: string): string | undefined {
  const prefix = "/api/gallery/image/";
  if (!pathname.startsWith(prefix)) return undefined;
  const id = decodeURIComponent(pathname.slice(prefix.length).split("/")[0] ?? "");
  if (!id || !GALLERY_ID_PATTERN.test(id) || id.includes("..")) return undefined;
  return id;
}

export function defaultGalleryImagePolicy(defaultRating: string): GalleryImagePolicyFn {
  return (item) =>
    item.rating === defaultRating ? { cache: "immutable" } : { cache: "no-store" };
}

export async function serveGalleryImageRequest(
  req: Request,
  url: URL,
  host: SessionHost,
  policy: GalleryImagePolicyFn,
): Promise<Response> {
  const entryId = parseGalleryImagePath(url.pathname);
  if (!entryId) {
    return new Response("Not found", { status: 404 });
  }

  const item = await host.galleryGet(entryId);
  if (!item?.unlocked || !item.available) {
    return new Response("Not found", { status: 404 });
  }

  const image = await host.galleryImage(entryId);
  if (!image) {
    return new Response("Not found", { status: 404 });
  }

  const v = url.searchParams.get("v");
  if (!v || v !== image.ref.id) {
    return new Response("Not found", { status: 404 });
  }

  const cache = policy(item);
  const cacheControl = cache.cache === "immutable" ? IMMUTABLE_HEADERS : NO_STORE_HEADERS;
  const etag = `"${image.ref.id}"`;
  const inm = req.headers.get("if-none-match");
  if (inm === etag) {
    return new Response(null, {
      status: 304,
      headers: {
        etag,
        "cache-control": cacheControl,
      },
    });
  }

  const headers: Record<string, string> = {
    "content-type": image.ref.mime,
    "content-length": String(image.bytes.byteLength),
    etag,
    "cache-control": cacheControl,
  };

  if (req.method === "HEAD") {
    return new Response(null, { status: 200, headers });
  }
  if (req.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }

  return new Response(image.bytes, { status: 200, headers });
}
