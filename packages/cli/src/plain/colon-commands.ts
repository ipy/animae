import type { Engine, Viewer } from "@animae/engine";

export interface PlainCommandApi {
  engine: Engine;
  viewer: Viewer;
  notify(msg: string): void;
}

export async function runColonCommand(line: string, api: PlainCommandApi): Promise<"quit" | void> {
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
      api.notify(
        ":save :load :rewind <eventId> :branches :explain [turnId] :query <viewer> <path> :advance <duration> :help :quit",
      );
      return;
    case "quit":
      return "quit";
    case "save": {
      const slot = await api.engine.timeline.save();
      api.notify(`Saved ${slot.label} @ ${slot.eventId}`);
      return;
    }
    case "load": {
      const slot = args[0];
      if (!slot) {
        api.notify("Usage: :load <slot>");
        return;
      }
      await api.engine.timeline.load(slot);
      api.notify(`Loaded ${slot}`);
      return;
    }
    case "rewind": {
      const id = args[0];
      if (!id) {
        api.notify("Usage: :rewind <eventId>");
        return;
      }
      await api.engine.timeline.rewind(id);
      api.notify(`Rewound to ${id}`);
      return;
    }
    case "branches": {
      const branches = await api.engine.timeline.branches();
      api.notify(branches.map((b) => b.name).join(", ") || "(none)");
      return;
    }
    case "explain": {
      const turnId = args[0];
      if (!turnId) {
        api.notify("Usage: :explain <turnId>");
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
        api.notify("Usage: :query <viewer> <path>");
        return;
      }
      api.notify(JSON.stringify(api.engine.query(viewer as Viewer, path), null, 2));
      return;
    }
    case "advance": {
      const dur = args.join(" ");
      if (!dur) {
        api.notify("Usage: :advance <duration>");
        return;
      }
      await api.engine.world.advance(dur);
      api.notify(`Advanced ${dur}`);
      return;
    }
    default:
      api.notify(`Unknown command: ${name}`);
  }
}
