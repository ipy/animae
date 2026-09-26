import type { HostCommand, HostCommandApi } from "./types.ts";
import { formatGalleryError } from "./gallery-errors.ts";

export interface GalleryCommandOptions {
  /** Open image file with OS viewer; when absent `:gallery open` prints the path. */
  openFile?: (path: string) => void | Promise<void>;
}

function tr(api: HostCommandApi, key: string, params?: Record<string, string | number>): string {
  return api.t?.(key, params) ?? key;
}

function locale(api: HostCommandApi): string {
  return api.locale?.() ?? "en";
}

async function withGallery<T>(api: HostCommandApi, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    api.notify(formatGalleryError(err, (k, p) => tr(api, k, p)), "error");
    throw err;
  }
}

function listOpts(api: HostCommandApi, args: string[]): { includeUnavailable?: boolean; ratingFilter?: string } {
  const all = args.includes("--all");
  const ratingArg = args.find((a) => a.startsWith("--rating="))?.slice("--rating=".length);
  return { includeUnavailable: all, ratingFilter: ratingArg };
}

export function createGalleryCommand(opts: GalleryCommandOptions = {}): HostCommand {
  return {
    description: "command.desc.gallery",
    usage: "command.usage.gallery" as const,
    run: async (args, api) => {
      const sub = (args[0] ?? "list").toLowerCase();
      const rest = args.slice(1).filter((a) => !a.startsWith("--"));
      const flags = args.slice(1).filter((a) => a.startsWith("--"));
      const loc = locale(api);
      const gallery = api.engine.gallery;

      switch (sub) {
        case "list": {
          const { includeUnavailable, ratingFilter } = listOpts(api, [...rest, ...flags]);
          const items = await withGallery(api, () =>
            gallery.list({ locale: loc, includeUnavailable: includeUnavailable ?? false }),
          );
          const filtered = ratingFilter ? items.filter((i) => i.rating === ratingFilter) : items;
          if (!filtered.length) return tr(api, "command.gallery.list_empty");
          return filtered
            .map((i) => {
              const lock = i.unlocked ? "" : tr(api, "command.gallery.locked_suffix");
              const job = i.job ? ` [${i.job.state}${i.job.progress != null ? ` ${Math.round(i.job.progress * 100)}%` : ""}]` : "";
              return `${i.id}\t${i.title}${lock}\t${i.rating}${job}`;
            })
            .join("\n");
        }
        case "show": {
          const id = rest[0];
          if (!id) {
            api.notify(tr(api, "command.gallery.show_usage"), "warn");
            return;
          }
          const item = await withGallery(api, () => gallery.get(id, { locale: loc }));
          if (!item) {
            api.notify(tr(api, "command.gallery.not_found", { id }), "warn");
            return;
          }
          const lines = [
            `${tr(api, "command.gallery.field_id")}: ${item.id}`,
            `${tr(api, "command.gallery.field_title")}: ${item.title}`,
            `${tr(api, "command.gallery.field_rating")}: ${item.rating}`,
            `${tr(api, "command.gallery.field_unlocked")}: ${item.unlocked ? tr(api, "command.gallery.yes") : tr(api, "command.gallery.no")}`,
          ];
          if (item.caption) lines.push(`${tr(api, "command.gallery.field_caption")}: ${item.caption}`);
          if (item.hint && !item.unlocked) lines.push(`${tr(api, "command.gallery.field_hint")}: ${item.hint}`);
          if (item.image) {
            lines.push(
              `${tr(api, "command.gallery.field_image")}: ${item.image.path} (${item.image.width}x${item.image.height}, ${item.image.mime})`,
            );
          }
          return lines.join("\n");
        }
        case "capture": {
          const focus = rest.join(" ").trim() || undefined;
          const { item, job } = await withGallery(api, () => gallery.capture(focus ? { focus } : undefined));
          return tr(api, "command.gallery.capture_started", { item, job });
        }
        case "render": {
          const id = rest[0];
          if (!id) {
            api.notify(tr(api, "command.gallery.render_usage"), "warn");
            return;
          }
          const reroll = flags.includes("--reroll");
          const { job } = await withGallery(api, () => gallery.render(id, { reroll }));
          return tr(api, "command.gallery.render_started", { id, job });
        }
        case "cancel": {
          const jobs = gallery.jobs().filter((j) => j.state !== "done" && j.state !== "failed" && j.state !== "cancelled");
          const jobId = rest[0] ?? jobs[0]?.id;
          if (!jobId) {
            api.notify(tr(api, "command.gallery.no_active_job"), "warn");
            return;
          }
          const ok = await withGallery(api, () => gallery.cancel(jobId));
          return ok ? tr(api, "command.gallery.cancelled", { job: jobId }) : tr(api, "command.gallery.cancel_failed", { job: jobId });
        }
        case "remove": {
          const id = rest[0];
          if (!id) {
            api.notify(tr(api, "command.gallery.remove_usage"), "warn");
            return;
          }
          await withGallery(api, () => gallery.remove(id));
          return tr(api, "command.gallery.removed", { id });
        }
        case "pin":
        case "unpin": {
          const id = rest[0];
          if (!id) {
            api.notify(tr(api, "command.gallery.pin_usage"), "warn");
            return;
          }
          const pinned = sub === "pin";
          await withGallery(api, () => gallery.pin(id, pinned));
          return pinned ? tr(api, "command.gallery.pinned", { id }) : tr(api, "command.gallery.unpinned", { id });
        }
        case "open": {
          const id = rest[0];
          if (!id) {
            api.notify(tr(api, "command.gallery.open_usage"), "warn");
            return;
          }
          const img = await withGallery(api, () => gallery.image(id));
          if (!img) {
            api.notify(tr(api, "command.gallery.no_image", { id }), "warn");
            return;
          }
          const path = img.ref.path;
          const open = opts.openFile ?? api.openFile;
          if (open) {
            await open(path);
            return tr(api, "command.gallery.opened", { path });
          }
          return path;
        }
        case "ratings":
        case "rate": {
          const rows = gallery.ratings();
          if (!rows.length) return tr(api, "command.gallery.ratings_empty");
          return rows.map((r) => `${r.id}\t${r.label}\t${r.available ? tr(api, "command.gallery.yes") : tr(api, "command.gallery.no")}`).join("\n");
        }
        case "jobs": {
          const jobs = gallery.jobs();
          if (!jobs.length) return tr(api, "command.gallery.jobs_empty");
          return jobs
            .map((j) => `${j.id}\t${j.item}\t${j.state}${j.progress != null ? `\t${Math.round(j.progress * 100)}%` : ""}`)
            .join("\n");
        }
        case "unlock": {
          const id = rest[0];
          if (!id) {
            api.notify(tr(api, "command.gallery.unlock_usage"), "warn");
            return;
          }
          await withGallery(api, () => gallery.unlock(id));
          return tr(api, "command.gallery.unlocked", { id });
        }
        default:
          api.notify(tr(api, "command.gallery.unknown_sub", { sub }), "warn");
          api.notify(tr(api, "command.gallery.help_hint"), "info");
      }
    },
  };
}

export const galleryHostCommand = createGalleryCommand();
