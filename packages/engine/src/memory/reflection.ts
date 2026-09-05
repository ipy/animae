import { z } from "zod";
import type { CharacterId, EventDraft, SceneId } from "../types.ts";
import type { Kernel } from "../contracts.ts";
import { stringifyYaml } from "../store/util.ts";
import { summaryMdPath } from "./util.ts";

export const ReflectionOutputSchema = z.strictObject({
  summaries: z.array(z.string()),
  goal_changes: z.array(
    z.strictObject({
      id: z.string().optional(),
      action: z.enum(["add", "remove", "update"]),
      text: z.string(),
      tags: z.array(z.string()).default([]),
      priority: z.number().optional(),
    }),
  ),
  new_claims: z.array(z.strictObject({ s: z.string(), p: z.string(), o: z.string() })),
});

export type ReflectionOutput = z.infer<typeof ReflectionOutputSchema>;

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

  const proposal = await k.models.s2.object({
    label: "reflect",
    segments: { static: "", semiStatic: "", dynamic: prompt, user: "Produce reflection JSON." },
    schema: ReflectionOutputSchema,
    maxOutputTokens: k.policy.router.budget?.maxOutputTokens.s2 ?? 800,
  });

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
