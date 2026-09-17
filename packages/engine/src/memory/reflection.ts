import { z } from "zod";
import { AnimaeError, type CharacterId, type EventDraft, type SceneId } from "../types.ts";
import type { Kernel } from "../contracts.ts";
import { stringifyYaml } from "../store/util.ts";
import { summaryMdPath } from "./util.ts";

// Model output, not authored data: keys a model adds on its own (`confidence`, `reason`, `mood`) are dropped instead of
// failing the reflection, so these are plain (stripping) objects rather than strict ones.
const goalChangeSchema = z.object({
  id: z.string().optional(),
  action: z.enum(["add", "remove", "update"]),
  text: z.string(),
  tags: z.array(z.string()).default([]),
  priority: z.number().optional(),
});

export const ReflectionOutputSchema = z.object({
  summaries: z.array(z.string()),
  goal_changes: z.array(goalChangeSchema),
  new_claims: z.array(z.object({ s: z.string(), p: z.string(), o: z.string() })),
});

export type ReflectionOutput = z.infer<typeof ReflectionOutputSchema>;

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v == null || typeof v !== "object" || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

/** Map common provider drift (`reflection`/`memories`/`emotions`) into the strict reflection shape. */
export function coerceReflectionRaw(raw: Record<string, unknown>): Record<string, unknown> {
  if (Array.isArray(raw.summaries) && Array.isArray(raw.goal_changes) && Array.isArray(raw.new_claims)) {
    return raw;
  }
  const summaries: string[] = [];
  if (Array.isArray(raw.summaries)) summaries.push(...raw.summaries.map(String));
  if (typeof raw.reflection === "string" && raw.reflection.trim()) summaries.push(raw.reflection.trim());
  if (typeof raw.summary === "string" && raw.summary.trim()) summaries.push(raw.summary.trim());
  if (Array.isArray(raw.memories)) {
    for (const m of raw.memories) {
      if (typeof m === "string") summaries.push(m);
      else if (m && typeof m === "object" && "text" in m) summaries.push(String((m as { text: unknown }).text));
    }
  }
  if (typeof raw.emotions === "string" && raw.emotions.trim()) summaries.push(raw.emotions.trim());

  let goal_changes = Array.isArray(raw.goal_changes) ? raw.goal_changes : [];
  if (!goal_changes.length && Array.isArray(raw.goals)) {
    goal_changes = raw.goals.map((g) =>
      typeof g === "string"
        ? { action: "update", text: g, tags: [] }
        : { action: "update", text: String(g), tags: [] },
    );
  }

  let new_claims = Array.isArray(raw.new_claims) ? raw.new_claims : [];
  if (!new_claims.length && Array.isArray(raw.claims)) {
    new_claims = raw.claims.filter((c) => c && typeof c === "object");
  }

  return {
    summaries,
    goal_changes,
    new_claims,
  };
}

export const ReflectionResponseSchema = z.preprocess(
  (v) => coerceReflectionRaw(asRecord(v) ?? {}),
  ReflectionOutputSchema,
);

export function goalConflict(card: { constraints: { taboos: string[]; bottom_lines: { tags: string[] }[] } }, goalTags: string[]): boolean {
  const forbidden = new Set<string>([...card.constraints.taboos]);
  for (const bl of card.constraints.bottom_lines) for (const t of bl.tags) forbidden.add(t);
  return goalTags.some((t) => forbidden.has(t));
}

export async function runReflectionForOwner(
  k: Kernel,
  sceneId: SceneId,
  owner: CharacterId,
  writeSummary: (owner: CharacterId, text: string, id: string) => Promise<void>,
): Promise<{ owner: CharacterId; accepted: boolean }> {
  const state = k.timeline.state();
  const def = k.catalog.character(owner);
  if (!def) return { owner, accepted: false };

  const sceneEvents = k.timeline.events().filter((e) => e.scene === sceneId);
  const memLines = sceneEvents
    .filter((e) => e.kind === "memory.written" && (e as { owner?: string }).owner === owner)
    .map((e) => JSON.stringify(e))
    .join("\n");
  const prompt = [
    `Reflect on scene ${sceneId} for character ${owner}.`,
    "Recent scene events and memories:",
    ...sceneEvents.slice(-40).map((e) => `${e.kind}: ${JSON.stringify(e)}`),
    memLines,
  ].join("\n");

  let proposal: ReflectionOutput;
  try {
    proposal = await k.models.s2.object({
      label: "reflect",
      segments: { static: "", semiStatic: "", dynamic: prompt, user: "Produce reflection JSON." },
      schema: ReflectionResponseSchema,
      maxOutputTokens: k.policy.router.budget?.maxOutputTokens.s2 ?? 800,
    });
  } catch (err) {
    // Reflection is a background nicety: an unusable answer or a provider hiccup must not fail the end of the scene.
    // A replay miss is still an error, because it means the recording does not match the run.
    if (err instanceof AnimaeError && err.code === "RECORDING_MISSING") throw err;
    k.warn("REFLECTION_FAILED", err instanceof Error ? err.message : String(err), { owner, sceneId });
    return { owner, accepted: false };
  }

  await k.emit([
    {
      kind: "reflection.proposed",
      source: "memory",
      owner,
      sceneId,
      proposal,
    } as EventDraft,
  ]);

  let acceptedAny = false;
  for (const change of proposal.goal_changes) {
    const conflict = goalConflict(def.card, change.tags);
    const ctx = k.celContext({
      self: owner,
      extra: {
        goal: { id: change.id, text: change.text, tags: change.tags },
        conflict,
        proposal: change,
      },
    });
    const ok = k.rules.cel.bool(k.policy.reflection.accept, ctx);
    if (ok) {
      acceptedAny = true;
      await k.emit([
        {
          kind: "reflection.accepted",
          source: "memory",
          owner,
          summaries: proposal.summaries,
          goal_changes: [change],
          new_claims: proposal.new_claims,
        } as EventDraft,
      ]);
    } else {
      await k.emit([
        {
          kind: "reflection.rejected",
          source: "memory",
          owner,
          reason: conflict ? "conflict with constraints" : "policy rejected",
          goal_change: change,
        } as EventDraft,
      ]);
    }
  }

  if (proposal.goal_changes.length === 0 && (proposal.summaries.length > 0 || proposal.new_claims.length > 0)) {
    acceptedAny = true;
    await k.emit([
      {
        kind: "reflection.accepted",
        source: "memory",
        owner,
        summaries: proposal.summaries,
        goal_changes: [],
        new_claims: proposal.new_claims,
      } as EventDraft,
    ]);
  }

  if (acceptedAny) {
    for (let i = 0; i < proposal.summaries.length; i++) {
      const summaryId = `sum_${sceneId}_${i}`;
      await writeSummary(owner, proposal.summaries[i]!, summaryId);
    }
  }

  return { owner, accepted: acceptedAny };
}

export function formatSummaryMarkdown(summaryId: string, text: string, owner: string, sceneId: string): string {
  const fm = stringifyYaml({
    name: summaryId,
    description: "Scene reflection summary",
    scope: `character:${owner}`,
    inject: "always",
    tags: ["reflection", "summary"],
    priority: 0,
    scene: sceneId,
  });
  return `---\n${fm}---\n${text}\n`;
}
