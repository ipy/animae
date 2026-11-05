import { describe, expect, test } from "bun:test";
import { sniffImageDimensions } from "../../src/gallery/sniff.ts";

function riffWebp(innerFour: string, payload: number[]): Uint8Array {
  const body = [...innerFour.split("").map((c) => c.charCodeAt(0)), ...payload];
  const size = 4 + body.length;
  const out = new Uint8Array(12 + body.length);
  out.set([0x52, 0x49, 0x46, 0x46, size & 0xff, (size >> 8) & 0xff, (size >> 16) & 0xff, (size >> 24) & 0xff]);
  out.set([0x57, 0x45, 0x42, 0x50], 8);
  out.set(body, 12);
  return out;
}

describe("sniffImageDimensions webp chunks", () => {
  test("VP8 lossy chunk", () => {
    const bytes = riffWebp("VP8 ", [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 64, 0, 48, 0]);
    expect(sniffImageDimensions(bytes)).toEqual({ width: 64, height: 48, mime: "image/webp" });
  });

  test("VP8L lossless chunk", () => {
    const bits = (100 - 1) | ((80 - 1) << 14);
    const bytes = riffWebp("VP8L", [
      0,
      0,
      0,
      0,
      0,
      bits & 0xff,
      (bits >> 8) & 0xff,
      (bits >> 16) & 0xff,
      (bits >> 24) & 0xff,
      ...new Array(10).fill(0),
    ]);
    expect(bytes.length).toBeGreaterThanOrEqual(30);
    expect(sniffImageDimensions(bytes)).toEqual({ width: 100, height: 80, mime: "image/webp" });
  });

  test("VP8X extended chunk", () => {
    const bytes = riffWebp("VP8X", [0, 0, 0, 0, 0, 0, 0, 0, 99, 0, 0, 49, 0, 0, ...new Array(6).fill(0)]);
    expect(bytes.length).toBeGreaterThanOrEqual(30);
    expect(sniffImageDimensions(bytes)).toEqual({ width: 100, height: 50, mime: "image/webp" });
  });

  test("webp with explicit mime but short buffer returns undefined", () => {
    expect(sniffImageDimensions(new Uint8Array(8), "image/webp")).toBeUndefined();
  });
});
