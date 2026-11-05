import { describe, expect, test } from "bun:test";
import { imageMimeFromBytes, sniffImageDimensions } from "../../src/gallery/sniff.ts";

function pngBytes(w: number, h: number): Uint8Array {
  const buf = new Uint8Array(24);
  buf[0] = 0x89;
  buf[1] = 0x50;
  buf[2] = 0x4e;
  buf[3] = 0x47;
  buf[16] = (w >> 24) & 0xff;
  buf[17] = (w >> 16) & 0xff;
  buf[18] = (w >> 8) & 0xff;
  buf[19] = w & 0xff;
  buf[20] = (h >> 24) & 0xff;
  buf[21] = (h >> 16) & 0xff;
  buf[22] = (h >> 8) & 0xff;
  buf[23] = h & 0xff;
  return buf;
}

describe("gallery sniff", () => {
  test("imageMimeFromBytes detects png jpeg webp and rejects unknown", () => {
    expect(imageMimeFromBytes(pngBytes(1, 1))).toBe("image/png");
    expect(imageMimeFromBytes(new Uint8Array([0xff, 0xd8, 0xff, 0x00]))).toBe("image/jpeg");
    const webp = new Uint8Array(12);
    webp.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
    expect(imageMimeFromBytes(webp)).toBe("image/webp");
    expect(imageMimeFromBytes(new Uint8Array([0, 1, 2]))).toBeUndefined();
  });

  test("sniffImageDimensions reads png ihdr", () => {
    expect(sniffImageDimensions(pngBytes(640, 480))).toEqual({ width: 640, height: 480, mime: "image/png" });
    expect(sniffImageDimensions(new Uint8Array(10))).toBeUndefined();
  });

  test("sniffImageDimensions reads jpeg sof marker", () => {
    const jpeg = new Uint8Array([
      0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x64, 0x00, 0x80, 0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11,
      0x01, 0xff, 0xd9,
    ]);
    expect(sniffImageDimensions(jpeg)).toEqual({ width: 128, height: 100, mime: "image/jpeg" });
  });

  test("honours explicit mime when bytes are ambiguous", () => {
    const tiny = pngBytes(2, 2).slice(0, 8);
    expect(sniffImageDimensions(tiny, "image/png")).toBeUndefined();
  });
});
