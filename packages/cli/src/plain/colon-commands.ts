import type { Engine, Viewer } from "@animae/engine";
import { createCliI18n } from "../i18n/cli-i18n.ts";

export interface PlainCommandApi {
  engine: Engine;
  viewer: Viewer;
  notify(msg: string): void;
  /** BCP-47 UI locale for plain REPL messages (default: negotiate from env). */
  locale?: string;
}

export async function runColonCommand(line: string, api: PlainCommandApi): Promise<"quit" | void> {
  const i18n = createCliI18n(api.locale);
  const t = (key: string, params?: Record<string, string | number>) =>
    i18n.t(key, params, { ns: "cli" });

  const trimmed = line.trim();
  if (!trimmed.startsWith(":")) return;
  const body = trimmed.slice(1).trim();
  const parts = body.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
  const name = (parts[0] ?? "help").toLowerCase();
  const args = parts.slice(1).map((s) =>
    (s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")) ? s.slice(1, -1) : s,
  );

  switch (name) {
    case "help":
      api.notify(t("command.help_line"));
      return;
    case "quit":
      return "quit";
    case "save": {
      const slot = await api.engine.timeline.save();
      api.notify(t("command.saved", { label: slot.label, eventId: slot.eventId }));
      return;
    }
    case "load": {
      const slot = args[0];
      if (!slot) {
        api.notify(t("command.load_usage"));
        return;
      }
      await api.engine.timeline.load(slot);
      api.notify(t("command.loaded", { slot }));
      return;
    }
    case "rewind": {
      const id = args[0];
      if (!id) {
        api.notify(t("command.rewind_usage"));
        return;
      }
      await api.engine.timeline.rewind(id);
      api.notify(t("command.rewound", { eventId: id }));
      return;
    }
    case "branches": {
      const branches = await api.engine.timeline.branches();
      api.notify(branches.map((b) => b.name).join(", ") || t("command.branches_none"));
      return;
    }
    case "explain": {
      const turnId = args[0];
      if (!turnId) {
        api.notify(t("command.explain_usage"));
        return;
      }
      const ex = api.engine.explain(turnId, api.viewer);
      api.notify(JSON.stringify(ex.chain.map((c) => c.summary)));
      return;
    }
    case "query": {
      const [viewer, ...rest] = args;
      const path = rest.join(" ");
      if (!viewer || !path) {
        api.notify(t("command.query_usage"));
        return;
      }
      api.notify(JSON.stringify(api.engine.query(viewer as Viewer, path), null, 2));
      return;
    }
    case "advance": {
      const dur = args.join(" ");
      if (!dur) {
        api.notify(t("command.advance_usage"));
        return;
      }
      await api.engine.world.advance(dur);
      api.notify(t("command.advanced", { duration: dur }));
      return;
    }
    default:
      api.notify(t("command.unknown", { name }));
  }
}
