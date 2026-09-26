import { describe, expect, test } from "bun:test";
import { collectKnownGalleryErrorCodes, galleryErrorTextShowsBareCode } from "@animae/host";
import { resolveGalleryJobFailureReason } from "../src/gallery-job-error.ts";

const LOCALES = ["en", "zh-CN"] as const;

describe("resolveGalleryJobFailureReason (web client path)", () => {
  for (const locale of LOCALES) {
    test(`localizes every GALLERY_* code in ${locale}`, () => {
      for (const code of collectKnownGalleryErrorCodes()) {
        const text = resolveGalleryJobFailureReason({ code, message: code }, locale);
        expect(text.trim().length).toBeGreaterThan(0);
        expect(text).not.toBe(code);
        expect(galleryErrorTextShowsBareCode(text)).toBe(false);
      }
    });
  }

  test("prefers a human message when the server already localized", () => {
    const text = resolveGalleryJobFailureReason(
      { code: "GALLERY_BUSY", message: "Queue is full for now." },
      "en",
    );
    expect(text).toBe("Queue is full for now.");
  });
});
