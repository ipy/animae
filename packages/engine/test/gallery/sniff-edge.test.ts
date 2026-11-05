import { describe, expect, test } from "bun:test";
import { sniffImageDimensions } from "../../src/gallery/sniff.ts";

describe("sniff edge paths", () => {
  test("jpeg scan skips non-sof markers and rejects invalid dimensions", () => {
    const jpeg = new Uint8Array([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
      0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x00, 0x00, 0x00, 0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xd9,
    ]);
    expect(sniffImageDimensions(jpeg)).toBeUndefined();
  });

  test("png rejects non-positive or oversized dimensions", () => {
    const bad = new Uint8Array(24);
    bad[0] = 0x89;
    bad[1] = 0x50;
    bad[2] = 0x4e;
    bad[3] = 0x47;
    bad[16] = 0;
    bad[17] = 0;
    bad[18] = 0;
    bad[19] = 0;
    expect(sniffImageDimensions(bad, "image/png")).toBeUndefined();
  });

  test("webp unknown chunk returns undefined", () => {
    const buf = new Uint8Array(20);
    buf.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x41, 0x42, 0x43, 0x44]);
    expect(sniffImageDimensions(buf)).toBeUndefined();
  });

  test("explicit mime without matching bytes returns undefined", () => {
    expect(sniffImageDimensions(new Uint8Array([1, 2, 3]), "image/jpeg")).toBeUndefined();
  });
});
