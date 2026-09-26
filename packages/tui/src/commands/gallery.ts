import { localizeError } from "@animae/i18n";
import type { CommandApi } from "../types.ts";

function msg(api: CommandApi, key: string, params?: Record<string, string | number>): string {
  const t = api.t ?? ((k: string) => k);
  return t(key, params);
}

export async function runGalleryCommand(args: string[], api: CommandApi): Promise<string | void> {
  if (args.length === 0) {
    api.openOverlay("gallery");
    return;
  }
  const sub = (args[0] ?? "list").toLowerCase();
  const rest = args.slice(1).filter((a) => !a.startsWith("--"));
  const flags = args.slice(1).filter((a) => a.startsWith("--"));
  const loc = api.locale?.() ?? "en";
  const gallery = api.engine.gallery;

  const fail = (err: unknown) => {
    const t = api.t ?? ((k: string) => k);
    api.notify(localizeError(err, (key, params) => t(key, params as Record<string, string | number>)), "warn");
  };

  try {
    switch (sub) {
      case "list": {
        const includeUnavailable = flags.includes("--all");
        const items = await gallery.list({ locale: loc, includeUnavailable });
        if (!items.length) return msg(api, "command.gallery.list_empty");
        return items.map((i) => `${i.id}\t${i.title}\t${i.rating}`).join("\n");
      }
      case "show": {
        const id = rest[0];
        if (!id) {
          api.notify(msg(api, "command.gallery.show_usage"), "warn");
          return;
        }
        const item = await gallery.get(id, { locale: loc });
        if (!item) {
          api.notify(msg(api, "command.gallery.not_found", { id }), "warn");
          return;
        }
        return `${item.title}\n${item.caption ?? ""}`;
      }
      default:
        api.notify(msg(api, "command.gallery.delegated_hint"), "info");
        api.openOverlay("gallery");
    }
  } catch (err) {
    fail(err);
  }
}
