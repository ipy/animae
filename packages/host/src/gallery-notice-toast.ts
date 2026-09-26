import type { GalleryItemView, GalleryNotice } from "@animae/engine";
import { galleryJobFailureReason } from "./gallery-errors.ts";

export type GalleryNoticeToastContext = {
  locale: string;
  getItem: (id: string) => Promise<GalleryItemView | undefined>;
  maskTitle?: (item: GalleryItemView) => boolean;
  t: (key: string, params?: Record<string, string | number>) => string;
};

async function noticeTitle(ctx: GalleryNoticeToastContext, id: string): Promise<string | undefined> {
  try {
    const view = await ctx.getItem(id);
    if (!view || ctx.maskTitle?.(view)) return undefined;
    return view.title.trim() || undefined;
  } catch {
    return undefined;
  }
}

/** Localized toast text for a gallery notice, or `null` when the notice should not toast (e.g. `changed`). */
export async function galleryNoticeToast(
  notice: GalleryNotice,
  ctx: GalleryNoticeToastContext,
): Promise<{ level: "info" | "error"; text: string } | null> {
  if (notice.type === "changed") return null;
  if (notice.type === "unlocked") {
    const title = await noticeTitle(ctx, notice.item);
    const key = title ? "gallery.notice.unlocked" : "gallery.notice.unlocked_generic";
    const params = title ? { item: title } : undefined;
    return { level: "info", text: ctx.t(key, params) };
  }
  const j = notice.job;
  if (j.state === "done") {
    const title = await noticeTitle(ctx, j.item);
    return {
      level: "info",
      text: title
        ? ctx.t("gallery.notice.job_done", { item: title })
        : ctx.t("gallery.notice.job_done_generic"),
    };
  }
  if (j.state === "failed") {
    const title = await noticeTitle(ctx, j.item);
    const reason = galleryJobFailureReason(j.error?.code, ctx.t);
    return {
      level: "error",
      text: title
        ? ctx.t("gallery.notice.job_failed", { item: title, reason })
        : ctx.t("gallery.notice.job_failed_generic", { reason }),
    };
  }
  return null;
}
