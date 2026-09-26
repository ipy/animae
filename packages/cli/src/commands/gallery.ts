import { formatGalleryError } from "@animae/host";
import { createCliI18n } from "../i18n/cli-i18n.ts";
import { openEngine, type OpenEngineOptions } from "../engine-open.ts";
import { createCommandImagePort } from "../image-command-port.ts";
import { printError } from "../errors.ts";

export interface GalleryCliOptions extends OpenEngineOptions {
  json?: boolean;
  imageCommand?: string;
  imageCommandArgs?: string[];
}

function tCli(lang: string | undefined) {
  const i18n = createCliI18n(lang);
  return (key: string, params?: Record<string, string | number>) => i18n.t(key, params);
}

export async function runGallery(sub: string, rest: string[], opts: GalleryCliOptions): Promise<number> {
  const tr = tCli(opts.lang);
  let engine;
  try {
    const ports = opts.imageCommand
      ? { image: createCommandImagePort({ command: opts.imageCommand, args: opts.imageCommandArgs }) }
      : opts.ports;
    engine = await openEngine({ ...opts, ports });
  } catch (err) {
    printError(err);
    return 1;
  }

  const loc = opts.lang ?? engine.info().locale;
  const gallery = engine.gallery;
  const flags = rest.filter((a) => a.startsWith("--"));
  const args = rest.filter((a) => !a.startsWith("--"));

  try {
    switch (sub) {
      case "list": {
        const includeUnavailable = flags.includes("--all");
        const items = await gallery.list({ locale: loc, includeUnavailable });
        if (opts.json) {
          process.stdout.write(`${JSON.stringify(items, null, 2)}\n`);
          break;
        }
        if (!items.length) {
          process.stdout.write(`${tr("gallery.list_empty")}\n`);
          break;
        }
        for (const i of items) {
          process.stdout.write(`${i.id}\t${i.title}\t${i.rating}\t${i.unlocked ? "unlocked" : "locked"}\n`);
        }
        break;
      }
      case "show": {
        const id = args[0];
        if (!id) {
          process.stderr.write(`${tr("gallery.show_usage")}\n`);
          return 1;
        }
        const item = await gallery.get(id, { locale: loc });
        if (!item) {
          process.stderr.write(`${tr("gallery.not_found", { id })}\n`);
          return 1;
        }
        if (opts.json) {
          process.stdout.write(`${JSON.stringify(item, null, 2)}\n`);
        } else {
          process.stdout.write(`${item.title}\n${item.caption ?? ""}\n`);
        }
        break;
      }
      case "ratings": {
        const rows = gallery.ratings();
        if (opts.json) process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
        else {
          for (const r of rows) process.stdout.write(`${r.id}\t${r.label}\t${r.available}\n`);
        }
        break;
      }
      case "jobs": {
        const jobs = gallery.jobs();
        if (opts.json) process.stdout.write(`${JSON.stringify(jobs, null, 2)}\n`);
        else {
          for (const j of jobs) process.stdout.write(`${j.id}\t${j.item}\t${j.state}\n`);
        }
        break;
      }
      case "capture": {
        const focus = args.join(" ").trim() || undefined;
        const out = await gallery.capture(focus ? { focus } : undefined);
        if (opts.json) process.stdout.write(`${JSON.stringify(out)}\n`);
        else process.stdout.write(`${tr("gallery.capture_started", { item: out.item, job: out.job })}\n`);
        break;
      }
      case "render": {
        const id = args[0];
        if (!id) {
          process.stderr.write(`${tr("gallery.render_usage")}\n`);
          return 1;
        }
        const reroll = flags.includes("--reroll");
        const out = await gallery.render(id, { reroll });
        if (opts.json) process.stdout.write(`${JSON.stringify(out)}\n`);
        else process.stdout.write(`${tr("gallery.render_started", { id, job: out.job })}\n`);
        break;
      }
      case "cancel": {
        const job = args[0] ?? gallery.jobs().find((j) => j.state !== "done" && j.state !== "failed")?.id;
        if (!job) {
          process.stderr.write(`${tr("gallery.no_job")}\n`);
          return 1;
        }
        const ok = await gallery.cancel(job);
        process.stdout.write(`${ok ? tr("gallery.cancelled", { job }) : tr("gallery.cancel_failed", { job })}\n`);
        break;
      }
      case "remove": {
        const id = args[0];
        if (!id) {
          process.stderr.write(`${tr("gallery.remove_usage")}\n`);
          return 1;
        }
        await gallery.remove(id);
        process.stdout.write(`${tr("gallery.removed", { id })}\n`);
        break;
      }
      case "pin": {
        const id = args[0];
        const pinned = !flags.includes("--unpin");
        if (!id) {
          process.stderr.write(`${tr("gallery.pin_usage")}\n`);
          return 1;
        }
        await gallery.pin(id, pinned);
        process.stdout.write(`${pinned ? tr("gallery.pinned", { id }) : tr("gallery.unpinned", { id })}\n`);
        break;
      }
      default:
        process.stderr.write(`${tr("gallery.unknown_sub", { sub })}\n`);
        process.stderr.write(`${tr("gallery.help")}\n`);
        return 1;
    }
    await engine.close();
    return 0;
  } catch (err) {
    process.stderr.write(`${formatGalleryError(err, tr)}\n`);
    await engine.close();
    return 1;
  }
}
