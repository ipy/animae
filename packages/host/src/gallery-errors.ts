import { AnimaeError, GALLERY_ERROR_CODES } from "@animae/engine";

const GALLERY_CODE_TO_KEY: Record<(typeof GALLERY_ERROR_CODES)[number], string> = {
  GALLERY_NO_GENERATOR: "error.gallery_no_generator",
  GALLERY_UNKNOWN_ENTRY: "error.gallery_unknown_entry",
  GALLERY_LOCKED: "error.gallery_locked",
  GALLERY_RATING_UNAVAILABLE: "error.gallery_rating_unavailable",
  GALLERY_BUSY: "error.gallery_busy",
  GALLERY_BRIEF_INVALID: "error.gallery_brief_invalid",
  GALLERY_GENERATION_FAILED: "error.gallery_generation_failed",
};

export function galleryErrorMessageKey(code: string): string | undefined {
  if ((GALLERY_ERROR_CODES as readonly string[]).includes(code)) {
    return GALLERY_CODE_TO_KEY[code as (typeof GALLERY_ERROR_CODES)[number]];
  }
  return undefined;
}

export function formatGalleryError(
  err: unknown,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  if (err instanceof AnimaeError) {
    const key = galleryErrorMessageKey(err.code);
    if (key) return t(key, err.params as Record<string, string | number> | undefined);
    return err.localizedMessage((k, p) => t(k, p as Record<string, string | number> | undefined));
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

const GALLERY_CODE_RE = /GALLERY_[A-Z_]+/g;
const FW_OPEN = "\uFF08";
const FW_CLOSE = "\uFF09";

/** True when a `GALLERY_*` token is visible outside catalog parentheses (ASCII or fullwidth). */
export function galleryErrorTextShowsBareCode(text: string): boolean {
  if (!GALLERY_CODE_RE.test(text)) return false;
  GALLERY_CODE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = GALLERY_CODE_RE.exec(text)) !== null) {
    const code = match[0];
    const idx = match.index;
    const before = text.slice(Math.max(0, idx - 1), idx);
    const after = text.slice(idx + code.length, idx + code.length + 1);
    const open = before === "(" || before === FW_OPEN;
    const close = after === ")" || after === FW_CLOSE;
    if (!(open && close)) return true;
  }
  return false;
}

export function formatGalleryErrorCode(
  code: string,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  return formatGalleryError(new AnimaeError(code, code), t);
}

export function galleryJobFailureReason(
  code: string | undefined,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  if (!code) return t("gallery.notice.job_failed_unknown");
  return formatGalleryErrorCode(code, t);
}

export function collectKnownGalleryErrorCodes(): readonly string[] {
  return GALLERY_ERROR_CODES;
}
