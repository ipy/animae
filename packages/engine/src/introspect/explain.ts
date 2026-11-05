import type { Explanation, Kernel } from "../contracts.ts";
import type { RetrievalLogHit } from "../events.ts";
import { memorySyncList } from "../memory/service.ts";
import type { TurnId, Viewer } from "../types.ts";
import { evaluateVisibility, eventKindAllowed, eventVisible } from "./visibility.ts";

function modeLabel(m: unknown): string {
  const r = (m ?? {}) as { appraise?: string; render?: string; s2Tier?: string };
  const s1 = r.appraise === "rule" ? "rule" : "llm";
  const s2 = r.render === "rule" ? "rule" : r.s2Tier ? `llm:${r.s2Tier}` : "llm";
  return `S1:${s1} S2:${s2}`;
}

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
    case "route.decided": {
      const r = e as {
        appraise?: { backend?: string };
        render?: { backend?: string; tier?: string };
        triggers?: string[];
        escalated?: boolean;
      };
      const appraise = r.appraise?.backend === "llm" ? "S1" : "rule";
      const render = r.render?.backend === "llm" ? `S2:${r.render.tier}` : "rule";
      const triggers = r.triggers?.length ? ` [${r.triggers.join(", ")}]` : "";
      return `Route appraise=${appraise} render=${render}${r.escalated ? " (escalated)" : ""}${triggers}`;
    }
    case "narration":
      return `Narration (${String(e.style ?? "normal")}): ${String(e.text ?? "").slice(0, 80)}`;
    case "runtime.mode_changed":
      return `Mode ${e.before ? modeLabel(e.before) : "(start)"} → ${modeLabel(e.after)} (${String(e.reason ?? "")})`;
    case "runtime.fallback_used": {
      const err = (e.error ?? {}) as { code?: string };
      return `Fallback ${String(e.phase)}: ${String(e.from)} → ${String(e.to)} (${err.code ?? "error"})`;
    }
    case "budget.degraded":
      return `Budget degraded: ${String(e.action ?? "?")}${e.from ? ` (${String(e.from)} → ${String(e.to ?? "?")})` : ""}`;
    case "memory.written":
      return `Memory written (${e.kind})`;
    case "character.secret_unlocked":
      return `Secret unlocked: ${String(e.character)}/${String(e.secret)}`;
    default:
      return kind;
  }
}

function retrievalHitData(
  k: Kernel,
  viewer: Viewer,
  hit: RetrievalLogHit,
  grants: ReturnType<Kernel["timeline"]["state"]>["grants"],
  now: ReturnType<Kernel["timeline"]["now"]>,
): Record<string, unknown> {
  const base = { kind: hit.kind, id: hit.id, score: hit.score, owner: hit.owner };
  const memoryPath = `characters/${hit.owner}/memory`;
  const mayReadMemory =
    hit.kind === "memory" &&
    evaluateVisibility(k.policy, viewer, memoryPath, grants, now);
  if (mayReadMemory) {
    const entry = memorySyncList(k, hit.owner).find((m) => m.id === hit.id);
    if (entry?.text) return { ...base, text: entry.text };
  }
  if (hit.kind === "knowledge" && (viewer === "debug" || viewer === "author" || viewer === "gm")) {
    const doc = k.m.memory.readDoc(hit.id);
    if (doc) return { ...base, text: doc.body };
  }
  return base;
}

export function buildExplanation(k: Kernel, turnId: TurnId, viewer: Viewer): Explanation {
  const state = k.timeline.state();
  const now = k.timeline.now();
  const events = k.timeline.eventsByTurn(turnId);
  const chain: Explanation["chain"] = [];

  for (const e of events) {
    if (!eventVisible(k.policy, viewer, e as { kind: string; style?: string }, state.grants, now)) continue;
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

  const utteranceEv = events.find((ev) => ev.kind === "utterance");
  const hits = (utteranceEv as { retrieval?: RetrievalLogHit[] } | undefined)?.retrieval;
  if (hits?.length && eventKindAllowed(k.policy, viewer, "events", state.grants, now)) {
    for (const hit of hits) {
      const data = retrievalHitData(k, viewer, hit, state.grants, now);
      chain.push({
        eventId: utteranceEv!.id,
        kind: "retrieval",
        summary: `Retrieval ${hit.kind} ${hit.id} score=${hit.score.toFixed(3)}`,
        data,
      });
    }
  }

  return { turnId, viewer, chain };
}
