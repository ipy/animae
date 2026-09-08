import type { HostCommand, HostCommandApi } from "./types.ts";

export const hostBuiltinCommands: Record<string, HostCommand> = {
  help: {
    description: "Show command list",
    run: async (_args, api) => {
      api.notify(
        ":save :load :rewind <eventId> :branches :explain [turnId] :query <viewer> <path> :advance <duration> :help",
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
      api.notify("Open load UI or pass slot name", "warn");
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
      return branches.map((b) => b.name).join(", ") || "(none)";
    },
  },
  explain: {
    description: "Explain a turn",
    usage: ":explain [turnId]",
    run: async (args, api) => {
      const turnId = args[0];
      if (!turnId) {
        api.openOverlay("explain");
        api.notify("Pass turnId to explain", "warn");
        return;
      }
      const ex = api.engine.explain(turnId, api.viewer);
      return JSON.stringify(ex.chain.map((c) => c.summary));
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
    api.notify(`Unknown command: ${name}`, "warn");
    return;
  }
  const out = await cmd.run(args, api);
  if (typeof out === "string" && out.length > 0) {
    api.notify(out);
  }
}
