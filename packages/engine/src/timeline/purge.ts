import type { BranchRef, EngineEvent, EventId } from "../types.ts";
import type { EngineState } from "../state.ts";
import type { EventDraft } from "../types.ts";
import type { TimelineDeps } from "./deps.ts";
import { readEventsFile } from "./event-log.ts";
import { eventsPath } from "./paths.ts";
import { repairJsonlText } from "../store/util.ts";
import { deleteSnapshotsAfter } from "./snapshots.ts";
import { artifactPath, artifactsDir } from "./paths.ts";

const TEXT_FIELDS = ["text", "summaries", "claims"] as const;

export async function purgeEventsAndArtifacts(
  deps: TimelineDeps,
  ctx: {
    branch: string;
    chain: BranchRef[];
    state: EngineState;
    events: EngineEvent[];
    scope: { characters?: string[]; memoryIds?: string[]; sessions?: string[] };
    append: (drafts: EventDraft[]) => Promise<EngineEvent[]>;
  },
): Promise<void> {
  const chars = new Set(ctx.scope.characters ?? []);
  const memIds = new Set(ctx.scope.memoryIds ?? []);
  const sessions = ctx.scope.sessions ? new Set(ctx.scope.sessions) : null;

  for (const br of ctx.chain) {
    if (chars.size) {
      for (const c of chars) {
        await deps.storage.remove(artifactPath(br.name, `${c}/memory.jsonl`));
        const files = await deps.storage.listFiles(artifactsDir(br.name));
        for (const f of files) {
          if (f.includes(`/${c}/`) && f.includes("/summaries/")) await deps.storage.remove(f);
        }
      }
    }
    if (memIds.size) {
      for (const id of memIds) {
        const files = await deps.storage.listFiles(artifactsDir(br.name));
        for (const f of files) {
          if (f.endsWith(`${id}.md`) || f.includes(id)) await deps.storage.remove(f);
        }
      }
    }
  }

  const redactedIds: EventId[] = [];
  const newLines: string[] = [];
  for (const br of [ctx.branch]) {
    const { header, events, raw } = await readEventsFile(deps.storage, br);
    newLines.push(JSON.stringify(header));
    for (const e of events) {
      if (sessions && !sessions.has(e.sid)) {
        newLines.push(JSON.stringify(e));
        continue;
      }
      let ev = e;
      if (shouldRedactEvent(e, chars)) {
        ev = redactEvent(e);
        redactedIds.push(e.id);
      }
      newLines.push(JSON.stringify(ev));
    }
    await deps.storage.writeAtomic(eventsPath(br), `${newLines.join("\n")}\n`);
    void raw;
    await deleteSnapshotsAfter(deps.storage, br, 0);
  }

  await ctx.append([{ kind: "purge.applied", eventIds: redactedIds, scope: ctx.scope } as EventDraft]);
}

function shouldRedactEvent(e: EngineEvent, chars: Set<string>): boolean {
  if (e.kind === "utterance") {
    const sp = (e as { speaker?: string }).speaker;
    if (chars.size === 0 || (sp && chars.has(sp))) return true;
  }
  if (e.kind === "memory.written" || e.kind === "reflection.accepted") return chars.size === 0 || chars.has((e as { owner?: string }).owner ?? "");
  return false;
}

function redactEvent(e: EngineEvent): EngineEvent {
  const copy = { ...e } as Record<string, unknown>;
  for (const f of TEXT_FIELDS) {
    if (f in copy) copy[f] = "[redacted]";
  }
  if (copy.kind === "utterance") copy.text = "[redacted]";
  if (copy.kind === "reflection.accepted") {
    copy.summaries = ["[redacted]"];
    copy.new_claims = [];
  }
  return copy as EngineEvent;
}
