import type { Explanation, Kernel } from "../contracts.ts";
import type { TurnId, Viewer } from "../types.ts";
import { eventKindAllowed } from "./visibility.ts";

function oneLine(kind: string, e: Record<string, unknown>): string {
  switch (kind) {
    case "input.received":
      return `Input from ${e.actor}: ${String(e.text ?? "").slice(0, 80)}`;
    case "appraisal":
      return `Appraisal type=${(e.appraisal as { type?: string })?.type ?? "?"}`;
    case "check.rolled":
      return `Check ${e.expr} → ${e.total} vs DC ${e.dc} (${e.success ? "success" : "fail"})`;
    case "track.delta": {
      const d = e as { track?: string; delta?: number; before?: number; after?: number };
      return `Track ${d.track} ${(d.delta ?? 0) >= 0 ? "+" : ""}${d.delta ?? 0} (${d.before}→${d.after})`;
    }
    case "field.applied":
      return `Field applied: ${e.field}`;
    case "intent.decided":
      return `Intent: ${e.intent}`;
    case "route.decided":
      return `Route tier ${e.tier} (${((e.reasons as string[]) ?? []).join(", ")})`;
    case "memory.written":
      return `Memory written (${e.kind})`;
    default:
      return kind;
  }
}

export function buildExplanation(k: Kernel, turnId: TurnId, viewer: Viewer): Explanation {
  const state = k.timeline.state();
  const now = k.timeline.now();
  const events = k.timeline.eventsByTurn(turnId);
  const chain: Explanation["chain"] = [];

  for (const e of events) {
    if (!eventKindAllowed(k.policy, viewer, e.kind, state.grants, now)) continue;
    const payload = e as Record<string, unknown>;
    const item: Explanation["chain"][number] = {
      eventId: e.id,
      kind: e.kind,
      summary: oneLine(e.kind, payload),
    };
    if (viewer === "debug" || viewer === "author" || viewer === "gm") {
      item.data = structuredClone(payload);
    }
    chain.push(item);
  }

  const routeEv = events.find((ev) => ev.kind === "route.decided" || ev.kind === "utterance");
  const hits = (routeEv as { retrieval?: unknown; hits?: unknown })?.retrieval ?? (routeEv as { hits?: unknown })?.hits;
  if (hits && eventKindAllowed(k.policy, viewer, "events", state.grants, now)) {
    chain.push({
      eventId: routeEv?.id ?? events[events.length - 1]?.id ?? turnId,
      kind: "retrieval",
      summary: `Retrieval hits: ${Array.isArray(hits) ? hits.length : 0}`,
      data: viewer === "debug" ? hits : undefined,
    });
  }

  return { turnId, viewer, chain };
}
