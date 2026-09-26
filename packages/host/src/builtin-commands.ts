import type { LocalizableValue } from "@animae/i18n";
import type { HostCommand, HostCommandApi } from "./types.ts";
import { runLlmlogCommand } from "./llmlog-command.ts";
import { createGalleryCommand } from "./gallery-command.ts";

function msg(key: string, params?: Record<string, string | number>): LocalizableValue {
  return params ? { i18n: { key, params } } : { i18n: { key } };
}

function tr(api: HostCommandApi, key: string, params?: Record<string, string | number>): string {
  return api.t?.(key, params) ?? key;
}

export const hostBuiltinCommands: Record<string, HostCommand> = {
  help: {
    description: "command.desc.help",
    run: async (_args, api) => {
      api.notify(msg("command.help_line"));
    },
  },
  save: {
    description: "command.desc.save",
    usage: ":save [label]",
    run: async (args, api) => {
      const slot = await api.engine.timeline.save(args[0]);
      api.notify(msg("command.saved", { label: slot.label, eventId: slot.eventId }));
    },
  },
  load: {
    description: "command.desc.load",
    usage: ":load [slot]",
    run: async (args, api) => {
      if (args[0]) {
        await api.engine.timeline.load(args[0]!);
        api.notify(msg("command.loaded", { slot: args[0]! }));
        return;
      }
      api.openOverlay("loadSlots");
      api.notify(msg("command.load_ui_hint"), "warn");
    },
  },
  rewind: {
    description: "command.desc.rewind",
    usage: ":rewind <eventId>",
    run: async (args, api) => {
      const id = args[0];
      if (!id) {
        api.notify(msg("command.rewind_usage"), "warn");
        return;
      }
      await api.engine.timeline.rewind(id);
      api.notify(msg("command.rewound", { eventId: id }));
    },
  },
  branches: {
    description: "command.desc.branches",
    run: async (_args, api) => {
      const branches = await api.engine.timeline.branches();
      return branches.map((b) => b.name).join(", ") || tr(api, "command.branches_none");
    },
  },
  explain: {
    description: "command.desc.explain",
    usage: ":explain [turnId]",
    run: async (args, api) => {
      const turnId = args[0];
      if (!turnId) {
        api.openOverlay("explain");
        api.notify(msg("command.explain_hint"), "warn");
        return;
      }
      const ex = api.engine.explain(turnId, api.viewer);
      return JSON.stringify(ex.chain.map((c) => c.summary));
    },
  },
  query: {
    description: "command.desc.query",
    usage: ":query <viewer> <path>",
    run: async (args, api) => {
      const [viewer, ...rest] = args;
      const path = rest.join(" ");
      if (!viewer || !path) {
        api.notify(msg("command.query_usage"), "warn");
        return;
      }
      const value = api.engine.query(viewer, path);
      return JSON.stringify(value, null, 2);
    },
  },
  advance: {
    description: "command.desc.advance",
    usage: ":advance <duration>",
    run: async (args, api) => {
      const dur = args.join(" ");
      if (!dur) {
        api.notify(msg("command.advance_usage"), "warn");
        return;
      }
      await api.engine.world.advance(dur);
      api.notify(msg("command.advanced", { duration: dur }));
    },
  },
  llmlog: {
    description: "command.desc.llmlog",
    usage: ":llmlog [seq|dump]",
    run: runLlmlogCommand,
  },
  gallery: createGalleryCommand(),
};

export async function runHostCommandLine(
  line: string,
  api: HostCommandApi,
  extra: Record<string, HostCommand>,
): Promise<void> {
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
  const cmd = extra[name] ?? hostBuiltinCommands[name];
  if (!cmd) {
    api.notify(msg("command.unknown", { name }), "warn");
    return;
  }
  const out = await cmd.run(args, api);
  if (typeof out === "string" && out.length > 0) {
    api.notify(out);
  }
}
