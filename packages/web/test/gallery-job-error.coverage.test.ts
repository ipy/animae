import { expect, test } from "bun:test";
import { resolveGalleryJobFailureReason } from "../src/gallery-job-error.ts";

test("resolveGalleryJobFailureReason unknown non-gallery code echoes code via formatter", () => {
  const text = resolveGalleryJobFailureReason({ code: "WEIRD_CODE", message: "WEIRD_CODE" }, "en");
  expect(text).toBe("WEIRD_CODE");
});

test("resolveGalleryJobFailureReason without code uses job_failed_unknown", () => {
  const text = resolveGalleryJobFailureReason(undefined, "en");
  expect(text.toLowerCase()).toMatch(/fail|unknown|error/);
});

test("known GALLERY_* code localizes instead of bare code", () => {
  const text = resolveGalleryJobFailureReason({ code: "GALLERY_BUSY", message: "GALLERY_BUSY" }, "en");
  expect(text).not.toBe("GALLERY_BUSY");
  expect(text.toLowerCase()).toMatch(/busy|queue|full/);
});
