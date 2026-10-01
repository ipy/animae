import type { BottomLineSchema, CardFrontmatter, CharacterDef } from "../schema/authored.ts";
import { isNonPromptBody, stripHtmlComments } from "../prose/for-prompt.ts";
import type { z } from "zod";
import {
  CardFrontmatterSchema,
  GoalsFileSchema,
  RelationsFileSchema,
  SecretsFileSchema,
  TracksFileSchema,
  TraitsFileSchema,
} from "../schema/authored.ts";
import { parseFrontmatter, parseYaml } from "../store/util.ts";
import { parseKnowledgeMarkdown } from "./knowledge.ts";
import type { ConfigIssue } from "./errors.ts";
import { zodIssues } from "./errors.ts";

type BottomLine = z.infer<typeof BottomLineSchema>;

export function displayName(def: CharacterDef): string;
export function displayName(def: CardFrontmatter): string;
export function displayName(def: CharacterDef | CardFrontmatter): string {
  if ("origin" in def) {
    const c = def as CharacterDef;
    return c.card.identity.nickname ?? c.card.identity.name;
  }
  return (def as CardFrontmatter).identity.nickname ?? (def as CardFrontmatter).identity.name;
}

export function bottomLineTags(def: CharacterDef | { constraints: { bottom_lines: BottomLine[] } }): string[] {
  const lines = "card" in def ? def.card.constraints.bottom_lines : def.constraints.bottom_lines;
  const tags = new Set<string>();
  for (const bl of lines) for (const t of bl.tags) tags.add(t);
  return [...tags];
}

export function characterTags(def: CharacterDef): string[] {
  const tags = new Set<string>(def.card.tags);
  for (const g of def.goals) for (const t of g.tags) tags.add(t);
  for (const s of def.secrets) for (const t of s.tags) tags.add(t);
  for (const bl of def.card.constraints.bottom_lines) for (const t of bl.tags) tags.add(t);
  for (const t of def.card.constraints.taboos) tags.add(t);
  return [...tags];
}

export interface LoadedCharacter {
  def: CharacterDef;
  issues: ConfigIssue[];
  fileHashes: Record<string, string>;
}

export function loadCharacterFromFiles(
  charId: string,
  files: { path: string; content: string; hash: string }[],
): LoadedCharacter {
  const issues: ConfigIssue[] = [];
  const fileHashes: Record<string, string> = {};
  for (const f of files) fileHashes[f.path] = f.hash;

  const cardFile = files.find((f) => f.path.endsWith("/card.md"));
  if (!cardFile) {
    issues.push({ file: `characters/${charId}`, path: "card.md", message: "missing card.md" });
    return { def: emptyCharacter(charId), issues, fileHashes };
  }

  const { data, body } = parseFrontmatter(cardFile.content);
  const cardParsed = CardFrontmatterSchema.safeParse(data);
  if (!cardParsed.success) {
    issues.push(...zodIssues(cardFile.path, cardParsed.error));
    return { def: emptyCharacter(charId), issues, fileHashes };
  }
  const fmId = cardParsed.data.identity.id;
  if (fmId !== undefined && fmId !== charId) {
    issues.push({
      file: cardFile.path,
      path: "identity.id",
      message: `identity.id "${fmId}" must match directory name "${charId}"`,
    });
  }
  cardParsed.data.identity.id = charId;

  const traitsRaw = readYamlFileContent(files, `characters/${charId}/traits.yaml`);
  const tracksRaw = readYamlFileContent(files, `characters/${charId}/tracks.yaml`);
  const goalsRaw = readYamlFileContent(files, `characters/${charId}/goals.yaml`);
  const secretsRaw = readYamlFileContent(files, `characters/${charId}/secrets.yaml`);
  const relationsRaw = readYamlFileContent(files, `characters/${charId}/relations.yaml`);

  const traits = parseOptional(traitsRaw, TraitsFileSchema, `characters/${charId}/traits.yaml`, issues) ?? { event_mult: {} };
  const tracks = parseOptional(tracksRaw, TracksFileSchema, `characters/${charId}/tracks.yaml`, issues) ?? {
    self: {},
    toward: {},
    overrides: {},
  };
  const goals = parseOptional(goalsRaw, GoalsFileSchema, `characters/${charId}/goals.yaml`, issues) ?? [];
  const secrets = parseOptional(secretsRaw, SecretsFileSchema, `characters/${charId}/secrets.yaml`, issues) ?? [];
  const relations = parseOptional(relationsRaw, RelationsFileSchema, `characters/${charId}/relations.yaml`, issues) ?? [];

  const knowledge: CharacterDef["knowledge"] = [];
  for (const f of files) {
    const knowledgePrefix = `characters/${charId}/knowledge/`;
    if (!f.path.includes(knowledgePrefix) || !f.path.endsWith(".md")) continue;
    const rel = f.path;
    const { doc, issues: kIssues } = parseKnowledgeMarkdown(f.path, rel, f.content, charId);
    issues.push(...kIssues);
    if (doc) knowledge.push(doc);
  }
  knowledge.sort((a, b) => a.id.localeCompare(b.id));

  const def: CharacterDef = {
    id: charId,
    origin: "authored",
    card: cardParsed.data,
    persona: (() => {
      const cleaned = stripHtmlComments(body).trim();
      const stubTail = /\n---\n\{\}\n---[\s\S]*$/;
      const withoutStub = cleaned.replace(stubTail, "").trim();
      return isNonPromptBody(withoutStub) ? "" : withoutStub;
    })(),
    traits,
    tracks,
    goals,
    secrets,
    relations,
    knowledge,
  };
  return { def, issues, fileHashes };
}

function emptyCharacter(id: string): CharacterDef {
  return {
    id,
    origin: "authored",
    card: CardFrontmatterSchema.parse({ identity: { name: id }, tags: [] }),
    persona: "",
    traits: { event_mult: {} },
    tracks: { self: {}, toward: {}, overrides: {} },
    goals: [],
    secrets: [],
    relations: [],
    knowledge: [],
  };
}

function readYamlFileContent(files: { path: string; content: string }[], path: string): unknown {
  const f = files.find((x) => x.path === path);
  if (!f) return undefined;
  return parseYaml(f.content);
}

function parseOptional<T>(
  raw: unknown,
  schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } } },
  file: string,
  issues: ConfigIssue[],
): T | undefined {
  if (raw === undefined) return undefined;
  const r = schema.safeParse(raw);
  if (!r.success) {
    issues.push(...zodIssues(file, r.error));
    return undefined;
  }
  return r.data;
}
