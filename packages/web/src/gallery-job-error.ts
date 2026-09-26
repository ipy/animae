import {
  createHostI18n,
  formatGalleryErrorCode,
  galleryErrorMessageKey,
  galleryErrorTextShowsBareCode,
  galleryJobFailureReason,
} from "@animae/host";

/** Player-visible failure reason for a gallery job (WebSocket `gallery_notice` / jobs list). */
export function resolveGalleryJobFailureReason(
  error: { code?: string; message?: string } | undefined,
  uiLocale: string,
): string {
  const code = error?.code;
  const msg = error?.message?.trim();
  if (msg && msg !== code && !galleryErrorTextShowsBareCode(msg)) return msg;
  if (code && galleryErrorMessageKey(code)) {
    const i18n = createHostI18n(uiLocale);
    return galleryJobFailureReason(code, (key, params) => i18n.t(key, params, { ns: "host" }));
  }
  if (code) {
    const i18n = createHostI18n(uiLocale);
    return formatGalleryErrorCode(code, (key, params) => i18n.t(key, params, { ns: "host" }));
  }
  const i18n = createHostI18n(uiLocale);
  return i18n.t("gallery.notice.job_failed_unknown", undefined, { ns: "host" });
}
