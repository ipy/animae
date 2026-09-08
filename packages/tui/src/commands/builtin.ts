import type { CommandApi, CustomCommand } from "../types.ts";

export const builtinCommands: Record<string, CustomCommand> = {
  help: {
    description: "Show command list",
    run: async (_args, api) => {
      api.notify(
        ":save :load :rewind <eventId> :branches :explain [turnId] :query <viewer> <path> :advance <duration> :help :quit",
      );
    },
  },
  save: {
    description: "Save timeline slot",
    run: async (_args, api) => {
      const slot = await api.engine.timeline.save();
      api.notify(`Saved ${slot.label} @ ${slot.eventId}`);
    },
  },
  load: {
    description: "Load save slot",
    usage: ":load [slot]",
    run: async (args, api) => {
      if (args[0]) {
        await api.engine.timeline.load(args[0]!);
        api.notify(`Loaded ${args[0]}`);
        return;
      }
      api.openOverlay("loadSlots");
    },
  },
  rewind: {
    description: "Rewind to event",
    usage: ":rewind <eventId>",
    run: async (args, api) => {
      const id = args[0];
      if (!id) {
        api.notify("Usage: :rewind <eventId>", "warn");
        return;
      }
      await api.engine.timeline.rewind(id);
      api.notify(`Rewound to ${id}`);
    },
  },
  branches: {
    description: "List branches",
    run: async (_args, api) => {
      const branches = await api.engine.timeline.branches();
      api.notify(branches.map((b) => b.name).join(", ") || "(none)");
    },
  },
  explain: {
    description: "Explain a turn",
    usage: ":explain [turnId]",
    run: async (args, api) => {
      const turnId = args[0];
      if (!turnId) {
        api.openOverlay("explain");
        return;
      }
      const ex = api.engine.explain(turnId, api.viewer);
      api.notify(JSON.stringify(ex.chain.map((c) => c.summary)));
    },
  },
  query: {
    description: "Query engine path",
    usage: ":query <viewer> <path>",
    run: async (args, api) => {
      const [viewer, ...rest] = args;
      const path = rest.join(" ");
      if (!viewer || !path) {
        api.notify("Usage: :query <viewer> <path>", "warn");
        return;
      }
      const value = api.engine.query(viewer, path);
      return JSON.stringify(value, null, 2);
    },
  },
  advance: {
    description: "Advance world time",
    usage: ":advance <duration>",
    run: async (args, api) => {
      const dur = args.join(" ");
      if (!dur) {
        api.notify("Usage: :advance <duration>", "warn");
        return;
      }
      await api.engine.world.advance(dur);
      api.notify(`Advanced ${dur}`);
    },
  },
  quit: {
    description: "Exit TUI",
    run: async () => {
      /* handled by runner */
    },
  },
  lang: {
    description: "Set UI language",
    usage: ":lang <locale>",
    run: async (args, api) => {
      const setUiLocale = api.setUiLocale;
      const t = api.t ?? ((k: string) => k);
      const loc = args[0]?.trim();
      if (!loc) {
        api.notify(t("command.lang_usage"), "warn");
        return;
      }
      setUiLocale?.(loc);
      api.notify(t("command.lang_set", { locale: loc }));
    },
  },
  mouse: {
    description: "Toggle terminal mouse capture (on|off|status)",
    usage: ":mouse [on|off|status]",
    run: async (args, api) => {
      const mode = (args[0] ?? "status").toLowerCase();
      if (mode === "on") {
        api.setMouseCapture(true);
        return "Mouse capture enabled (Shift+drag still selects text in most terminals).";
      }
      if (mode === "off") {
        api.setMouseCapture(false);
        return "Mouse capture disabled — native selection restored.";
      }
      return "Usage: :mouse on|off|status · shortcut Ctrl+M";
    },
  },
};

export async function runCommandLine(
  line: string,
  api: CommandApi,
  extra: Record<string, CustomCommand>,
): Promise<"quit" | void> {
  const parsed = line.trim();
  if (!parsed.startsWith(":")) return;
  const body = parsed.slice(1).trim();
  const parts = body.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
  const name = (parts[0] ?? "help").toLowerCase();
  const args = parts.slice(1).map((s) =>
    (s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))
      ? s.slice(1, -1)
      : s,
  );
  if (name === "quit") return "quit";
  const cmd = extra[name] ?? builtinCommands[name];
  if (!cmd) {
    api.notify(`Unknown command: ${name}`, "warn");
    return;
  }
  const out = await cmd.run(args, api);
  if (typeof out === "string" && out.length > 0) {
    api.notify(out);
  }
}
