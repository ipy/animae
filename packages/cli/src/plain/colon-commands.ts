import {
  RUNTIME_MODE_PRESETS,
  formatRuntimeMode,
  parseModeRequest,
  runtimeModePresetOf,
  type Engine,
  type Viewer,
} from "@animae/engine";
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
    case "mode": {
      const runtime = api.engine.runtime;
      const models = runtime.models();
      if (args.length === 0 || args[0]?.toLowerCase() === "status") {
        const mode = runtime.mode();
        const pending = runtime.pending();
        api.notify(
          t("command.mode_status", {
            mode: `[${formatRuntimeMode(mode, models)}]`,
            preset: runtimeModePresetOf(mode),
            presets: RUNTIME_MODE_PRESETS.join(", "),
            tiers: models.s2Tiers.map((tier) => tier.id).join(", ") || "-",
          }) + (pending ? ` ${t("command.mode_pending", { mode: `[${formatRuntimeMode(pending, models)}]` })}` : ""),
        );
        return;
      }
      const request = parseModeRequest(args);
      if (!request) {
        api.notify(t("command.mode_usage"));
        return;
      }
      try {
        const change = await runtime.setMode(request, { reason: "api", trigger: "cli:mode-command" });
        const after = `[${formatRuntimeMode(change.after, models)}]`;
        if (change.pending) api.notify(t("command.mode_queued", { mode: after }));
        else if (formatRuntimeMode(change.before, models) === formatRuntimeMode(change.after, models)) {
          api.notify(t("command.mode_unchanged", { mode: after }));
        } else api.notify(t("command.mode_changed", { before: `[${formatRuntimeMode(change.before, models)}]`, after }));
      } catch (err) {
        api.notify(err instanceof Error ? err.message : String(err));
      }
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
