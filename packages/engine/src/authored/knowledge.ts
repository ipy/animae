import { KnowledgeFrontmatterSchema, type KnowledgeDoc } from "../schema/authored.ts";
import { parseFrontmatter } from "../store/util.ts";
import { type ConfigIssue, zodIssues } from "./errors.ts";

export function knowledgeDocId(owner: "world" | `character:${string}`, relPath: string): string {
  const base = relPath.replace(/\.md$/i, "").replace(/\\/g, "/");
  if (owner === "world") return `world/${base}`;
  const charId = owner.slice("character:".length);
  const file = base.includes("/") ? base.split("/").pop()! : base;
  return `character:${charId}/${file}`;
}

export function parseKnowledgeMarkdown(
  file: string,
  relPath: string,
  text: string,
  owner?: string,
): { doc?: KnowledgeDoc; issues: ConfigIssue[] } {
  const { data, body } = parseFrontmatter(text);
  const parsed = KnowledgeFrontmatterSchema.safeParse(data);
  if (!parsed.success) return { issues: zodIssues(file, parsed.error) };
  const scope = parsed.data.scope;
  let docOwner: string | undefined;
  if (scope.startsWith("character:")) docOwner = scope.slice("character:".length);
  else if (owner) docOwner = owner;

  const id =
    scope === "world"
      ? knowledgeDocId("world", relPath.replace(/^world\/knowledge\//, ""))
      : knowledgeDocId(`character:${docOwner ?? owner ?? "unknown"}`, relPath.split("/").pop() ?? relPath);

  const doc: KnowledgeDoc = {
    ...parsed.data,
    id,
    body,
    path: relPath,
    owner: docOwner,
  };
  return { doc, issues: [] };
}
