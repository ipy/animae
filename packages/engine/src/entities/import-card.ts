import type { StoragePort } from "../ports.ts";
import { AnimaeError } from "../types.ts";
import { stringifyYaml } from "../store/util.ts";
import { extractSillyTavernJsonFromPng } from "./png-chunks.ts";
import { slugId } from "./slug.ts";

export interface SillyTavernCard {
  name?: string;
  description?: string;
  personality?: string;
  scenario?: string;
  first_mes?: string;
  mes_example?: string;
  character_book?: { entries?: StBookEntry[] };
  [k: string]: unknown;
}

interface StBookEntry {
  keys?: string[];
  content?: string;
  constant?: boolean;
  name?: string;
  [k: string]: unknown;
}

export async function importSillyTavernCard(storage: StoragePort, file: string, readJson: (path: string) => Promise<string>): Promise<string> {
  const lower = file.toLowerCase();
  let jsonText: string;
  if (lower.endsWith(".acard.jsonl")) {
    const { importAcard } = await import("./acard.ts");
    return importAcard(storage, file);
  }
  if (lower.endsWith(".png")) {
    const bytes = await storage.readBytes(file);
    if (!bytes) throw new AnimaeError("NOT_FOUND", file);
    const extracted = extractSillyTavernJsonFromPng(bytes);
    if (!extracted) throw new AnimaeError("CONFIG_INVALID", `${file}: no chara/ccv3 chunk in PNG`);
    jsonText = extracted;
  } else {
    jsonText = await readJson(file);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch {
    throw new AnimaeError("CONFIG_INVALID", `${file}: invalid JSON`);
  }
  const card = normalizeStCard(raw);
  if (!card.name) throw new AnimaeError("CONFIG_INVALID", `${file}: missing name`);

  const baseSlug = slugId(card.name);
  const charId = await pickUniqueCharId(baseSlug, async (id) => {
    const exists = await storage.exists(`characters/${id}`);
    const files = await storage.listFiles(`characters/${id}`);
    return exists || files.length > 0;
  });

  const persona = [card.description, card.personality].filter(Boolean).join("\n\n").trim();
  const styleExamples = splitMesExample(card.mes_example);
  const xImport: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(card)) {
    if (["name", "description", "personality", "scenario", "first_mes", "mes_example", "character_book"].includes(k)) continue;
    xImport[k] = v;
  }

  const frontmatter = {
    identity: {
      id: charId,
      name: card.name,
      summary: (card.description ?? "").slice(0, 200),
      greeting: card.first_mes,
      style_examples: styleExamples,
    },
    constraints: { motives: [], bottom_lines: [], taboos: [] },
    lod: "principal",
    tags: [],
    x_import: Object.keys(xImport).length ? xImport : undefined,
  };

  const cardMd = `---\n${stringifyYaml(frontmatter).trim()}\n---\n\n${persona}\n`;
  await storage.mkdir(`characters/${charId}`);
  await storage.mkdir(`characters/${charId}/knowledge`);
  await storage.writeAtomic(`characters/${charId}/card.md`, cardMd);

  if (card.scenario) {
    const scenarioFm = {
      name: "scenario",
      description: "Imported scenario",
      scope: `character:${charId}`,
      inject: "always",
      tags: [],
      priority: 0,
      shareable: false,
    };
    const scenarioMd = `---\n${stringifyYaml(scenarioFm).trim()}\n---\n\n${card.scenario}\n`;
    await storage.writeAtomic(`characters/${charId}/knowledge/scenario.md`, scenarioMd);
  }

  const entries = card.character_book?.entries ?? [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    const n = i + 1;
    const when = bookEntryWhen(entry);
    const inject = entry.constant ? "always" : when ? "when" : "on-demand";
    const fm: Record<string, unknown> = {
      name: entry.name ?? `entry-${n}`,
      description: "",
      scope: `character:${charId}`,
      inject,
      tags: [],
      priority: 0,
      shareable: false,
    };
    if (when) fm.when = when;
    const body = String(entry.content ?? "");
    const md = `---\n${stringifyYaml(fm).trim()}\n---\n\n${body}\n`;
    await storage.writeAtomic(`characters/${charId}/knowledge/${n}.md`, md);
  }

  return charId;
}

function normalizeStCard(raw: unknown): SillyTavernCard {
  if (!raw || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;
  if (o.data && typeof o.data === "object") {
    return { ...(o.data as SillyTavernCard), ...stripSpec(o) };
  }
  return o as SillyTavernCard;
}

function stripSpec(o: Record<string, unknown>): SillyTavernCard {
  const { spec, spec_version, data, ...rest } = o;
  void spec;
  void spec_version;
  void data;
  return rest as SillyTavernCard;
}

function splitMesExample(mes?: string): string[] {
  if (!mes) return [];
  return mes
    .split(/<START>/gi)
    .map((s) => s.trim())
    .filter(Boolean);
}

function bookEntryWhen(entry: StBookEntry): string | undefined {
  const keys = entry.keys?.filter(Boolean) ?? [];
  if (!keys.length) return undefined;
  const parts = keys.map((k) => {
    const esc = k.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return `(event.tags.exists(t, t == "${esc}") || event.text.lowerAscii().contains("${esc.toLowerCase()}"))`;
  });
  return parts.join(" || ");
}

async function pickUniqueCharId(base: string, exists: (id: string) => Promise<boolean>): Promise<string> {
  if (!(await exists(base))) return base;
  for (let n = 2; n < 10_000; n++) {
    const cand = `${base}-${n}`;
    if (!(await exists(cand))) return cand;
  }
  throw new AnimaeError("ENTITY_DUPLICATE", `no unique id for "${base}"`);
}
