import { describe, expect, test } from "bun:test";
import {
  collectKnownGalleryErrorCodes,
  createHostI18n,
  formatGalleryErrorCode,
  galleryErrorMessageKey,
  galleryErrorTextShowsBareCode,
  galleryJobFailureReason,
} from "../src/index.ts";

const LOCALES = ["en", "fr"] as const;

function hostT(locale: string) {
  const i18n = createHostI18n(locale);
  return (key: string, params?: Record<string, string | number>) => i18n.t(key, params, { ns: "host" });
}

function assertHumanGalleryError(text: string, locale: string, code: string): void {
  expect(text.trim().length, `${locale} ${code}`).toBeGreaterThan(0);
  expect(text, `${locale} ${code}`).not.toBe(code);
  expect(text, `${locale} ${code}`).not.toMatch(/^error\.gallery_/);
  expect(text, `${locale} ${code}`).not.toContain("undefined");
  expect(text, `${locale} ${code}`).not.toMatch(/\{[a-z_]+\}/i);
  expect(galleryErrorTextShowsBareCode(text), `${locale} ${code} bare code`).toBe(false);
}

describe("gallery error localization (host formatter)", () => {
  test("every engine GALLERY_* code maps to a host catalog key", () => {
    for (const code of collectKnownGalleryErrorCodes()) {
      expect(galleryErrorMessageKey(code), code).toBeTruthy();
    }
  });

  for (const locale of LOCALES) {
    test(`formatGalleryErrorCode renders every code in ${locale}`, () => {
      const t = hostT(locale);
      for (const code of collectKnownGalleryErrorCodes()) {
        const text = formatGalleryErrorCode(code, t);
        assertHumanGalleryError(text, locale, code);
      }
    });

    test(`galleryJobFailureReason renders every code in ${locale}`, () => {
      const t = hostT(locale);
      for (const code of collectKnownGalleryErrorCodes()) {
        const text = galleryJobFailureReason(code, t);
        assertHumanGalleryError(text, locale, code);
      }
      expect(galleryJobFailureReason(undefined, t).length).toBeGreaterThan(0);
    });
  }
});
