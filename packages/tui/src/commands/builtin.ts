import { localizeError, type FormatParams } from "@animae/i18n";
import type { CommandApi, CustomCommand } from "../types.ts";

type TFn = (key: string, params?: Record<string, string | number>) => string;

function msg(api: CommandApi, key: string, params?: Record<string, string | number>): string {
  const t = api.t ?? ((k: string) => k);
  return t(key, params);
}

/** Built-in `:` commands (descriptions resolved at palette render via `command.desc.*` keys). */
export const builtinCommands: Record<string, CustomCommand> = {
  help: {
    description: "command.desc.help",
    run: async (_args, api) => {
      api.notify(msg(api, "command.help_line"));
    },
  },
  save: {
    description: "command.desc.save",
    run: async (_args, api) => {
      const slot = await api.engine.timeline.save();
      api.notify(msg(api, "command.saved", { label: slot.label, eventId: slot.eventId }));
    },
  },
  load: {
    description: "command.desc.load",
    usage: "command.usage.load",
    run: async (args, api) => {
      if (args[0]) {
        await api.engine.timeline.load(args[0]!);
        api.notify(msg(api, "command.loaded", { label: args[0]! }));
        return;
      }
      api.openOverlay("loadSlots");
    },
  },
  rewind: {
    description: "command.desc.rewind",
    usage: "command.usage.rewind",
    run: async (args, api) => {
      const id = args[0];
      if (!id) {
        api.notify(msg(api, "command.rewind_usage"), "warn");
        return;
      }
      await api.engine.timeline.rewind(id);
      api.notify(msg(api, "command.rewound", { eventId: id }));
    },
  },
  branches: {
    description: "command.desc.branches",
    run: async (_args, api) => {
      const branches = await api.engine.timeline.branches();
      api.notify(branches.map((b) => b.name).join(", ") || msg(api, "command.branches_none"));
    },
  },
  explain: {
    description: "command.desc.explain",
    usage: "command.usage.explain",
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
    description: "command.desc.query",
    usage: "command.usage.query",
    run: async (args, api) => {
      const [viewer, ...rest] = args;
      const path = rest.join(" ");
      if (!viewer || !path) {
        api.notify(msg(api, "command.query_usage"), "warn");
        return;
      }
      const value = api.engine.query(viewer, path);
      return JSON.stringify(value, null, 2);
    },
  },
  advance: {
    description: "command.desc.advance",
    usage: "command.usage.advance",
    run: async (args, api) => {
      const dur = args.join(" ");
      if (!dur) {
        api.notify(msg(api, "command.advance_usage"), "warn");
        return;
      }
      await api.engine.world.advance(dur);
      api.notify(msg(api, "command.advanced", { duration: dur }));
    },
  },
  quit: {
    description: "command.desc.quit",
    run: async () => {
      /* handled by runner */
    },
  },
  lang: {
    description: "command.desc.lang",
    usage: "command.usage.lang",
    run: async (args, api) => {
      const setUiLocale = api.setUiLocale;
      const loc = args[0]?.trim();
      if (!loc) {
        api.notify(msg(api, "command.lang_usage"), "warn");
        return;
      }
      setUiLocale?.(loc);
      api.notify(msg(api, "command.lang_set", { locale: loc }));
    },
  },
  mouse: {
    description: "command.desc.mouse",
    usage: "command.usage.mouse",
    run: async (args, api) => {
      const mode = (args[0] ?? "status").toLowerCase();
      if (mode === "on") {
        api.setMouseCapture(true);
        return msg(api, "command.mouse_on");
      }
      if (mode === "off") {
        api.setMouseCapture(false);
        return msg(api, "command.mouse_off");
      }
      return msg(api, "command.mouse_usage");
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
    api.notify(msg(api, "command.unknown", { name }), "warn");
    return;
  }
  try {
    const out = await cmd.run(args, api);
    if (typeof out === "string" && out.length > 0) {
      api.notify(out);
    }
  } catch (err) {
    const t = api.t ?? ((key: string) => key);
    api.notify(
      localizeError(err, (key, params) => t(key, params as FormatParams & Record<string, string | number>)),
      "warn",
    );
  }
}
