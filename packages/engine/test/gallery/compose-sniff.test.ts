import { describe, expect, test } from "bun:test";
import { composeGalleryPrompts, dedupeJoin } from "../../src/gallery/compose.ts";
import { sniffImageDimensions } from "../../src/gallery/sniff.ts";

describe("gallery compose", () => {
  test("dedupeJoin is deterministic", () => {
    expect(dedupeJoin(["a, b", "B, c"], ", ")).toBe("a, b, c");
  });

  test("composeGalleryPrompts order", () => {
    const { prompt, negative } = composeGalleryPrompts({
      galleryStyle: "styleA",
      galleryNegative: "negA",
      ratingStyle: "styleB",
      ratingNegative: "negB",
      characterVisuals: ["visual1", "visual2"],
      renderPrompt: "scene prompt",
      renderNegative: "negC",
    });
    expect(prompt).toBe("styleA, styleB, visual1, visual2, scene prompt");
    expect(negative).toBe("negA, negB, negC");
  });
});

describe("gallery sniff", () => {
  test("rejects truncated PNG", () => {
    const truncated = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
    expect(sniffImageDimensions(truncated)).toBeUndefined();
  });

  test("rejects garbage bytes", () => {
    expect(sniffImageDimensions(Uint8Array.from([9, 9, 9, 9]))).toBeUndefined();
  });

  test("1x1 PNG dimensions", () => {
    const png = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00,
      0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78,
      0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44,
      0xae, 0x42, 0x60, 0x82,
    ]);
    const info = sniffImageDimensions(png);
    expect(info?.width).toBe(1);
    expect(info?.height).toBe(1);
    expect(info?.mime).toBe("image/png");
  });
});
