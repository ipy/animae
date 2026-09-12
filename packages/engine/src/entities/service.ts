import type { EntityService, Kernel } from "../contracts.ts";
import type { CharacterDef, Template } from "../schema/authored.ts";
import type { CharacterId, EntityRef, Lod } from "../types.ts";
import { AnimaeError } from "../types.ts";
import { adjudicateProposal, LOD_RANK, nextLod } from "./adjudicate.ts";
import { templateFieldsSchema } from "./descriptor.ts";
import { exportAcard } from "./acard.ts";
import { importSillyTavernCard } from "./import-card.ts";
import { generateFromBrief, resolveEntity, retireEntity, setEntityAlias, spawnEntity } from "./lifecycle.ts";

export function createEntityService(k: Kernel): EntityService {
  return {
    generate: (r, why) => generateEntity(k, r, why),
    promote: (id, to, why) => promoteCharacter(k, id, to, why),
    setAlias: (input) => setEntityAlias(k, input),
    resolve: (ref, opts) => resolveEntity(k, ref, opts),
    spawn: (spec, opts) => spawnEntity(k, spec, opts),
    retire: (ref, opts) => retireEntity(k, ref, opts),
    generateFromBrief: (brief, opts) => generateFromBrief(k, brief, opts),
    checkPromotions: (ids) => checkPromotions(k, ids),
    importCard: (file) =>
      importSillyTavernCard(k.storage, file, async (path) => {
        const t = await k.storage.readText(path);
        if (t === undefined) throw new AnimaeError("NOT_FOUND", path);
        return t;
      }),
    exportCard: (id) => exportAcard(k.storage, id),
  };
}

async function generateEntity(
  k: Kernel,
  r: { kind: "character" | "location" | "item"; template: string; hints?: Record<string, unknown> },
  why?: { source: string; because?: string[] },
): Promise<EntityRef> {
  const tpl = k.authored.templates[r.kind][r.template];
  if (!tpl) throw new AnimaeError("NOT_FOUND", `template ${r.kind}/${r.template} not found`);

  const schema = templateFieldsSchema(tpl.fields);
  const language = outputLanguage(k, r.hints);
  const segments = buildGeneratePrompt(k, tpl, r, language);
  const port = tpl.lod === "principal" ? k.models.s2 : k.models.s1;

  let proposal: Record<string, unknown>;
  try {
    const raw = await port.object({
      label: "generate",
      segments,
      schema,
      maxOutputTokens: 4096,
      temperature: 0.7,
    });
    proposal = schema.parse(raw) as Record<string, unknown>;
  } catch (e) {
    throw new AnimaeError("MODEL_FAILED", `generate failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  const { ref, data } = adjudicateProposal(r.kind, tpl, proposal, k.catalog, r.hints);
  await persistGenerated(k, ref, data, r.template);
  await k.emit(
    [
      {
        kind: "entity.created",
        entity: ref,
        template: r.template,
        data,
        source: why?.source ?? "entities.generate",
        because: why?.because ?? [],
      },
    ],
    { source: why?.source },
  );
  return ref;
}

function outputLanguage(k: Kernel, hints?: Record<string, unknown>): string {
  const hintLang = hints?.language;
  if (typeof hintLang === "string") return hintLang;
  return k.i18n.outputLocale ?? k.authored.world.language;
}

function buildGeneratePrompt(
  k: Kernel,
  tpl: Template,
  r: { kind: string; template: string; hints?: Record<string, unknown> },
  language: string,
): import("../ports.ts").PromptSegments {
  const rules = k.authored.world.rules_text ?? "";
  const staticParts = [
    rules && `World rules:\n${rules}`,
    `Output language: ${language} (all generated text must use this language).`,
    tpl.guidance && `Template guidance:\n${tpl.guidance}`,
  ].filter(Boolean);

  const existingNames = collectExistingNames(k, r.kind as "character" | "location" | "item");
  const dynamicParts = [
    r.hints && Object.keys(r.hints).length ? `Hints:\n${JSON.stringify(r.hints, null, 2)}` : "",
    existingNames.length ? `Avoid duplicating these names: ${existingNames.join(", ")}` : "",
  ].filter(Boolean);

  return {
    static: staticParts.join("\n\n"),
    semiStatic: "",
    dynamic: dynamicParts.join("\n\n"),
    user: `Generate a structured ${r.kind} proposal for template "${r.template}". Fill every required field in the schema.`,
  };
}

function collectExistingNames(k: Kernel, kind: "character" | "location" | "item"): string[] {
  if (kind === "character") return k.catalog.characters().map((c) => c.card.identity.name);
  if (kind === "location") return k.catalog.locations().map((l) => l.name);
  const names: string[] = [];
  for (const i of Object.values(k.authored.items)) names.push(i.name);
  for (const i of Object.values(k.timeline.state().generated.items)) names.push(i.name);
  return names;
}

async function persistGenerated(k: Kernel, ref: EntityRef, data: Record<string, unknown>, template: string): Promise<void> {
  const branch = k.timeline.branch().name;
  const path = `timelines/${branch}/entities/${ref.kind}/${ref.id}.json`;
  await k.storage.mkdir(`timelines/${branch}/entities/${ref.kind}`);
  const payload = { ...data, _template: template };
  await k.storage.writeAtomic(path, JSON.stringify(payload, null, 2));
}

async function promoteCharacter(
  k: Kernel,
  id: string,
  to: Lod,
  why?: { source: string; because?: string[] },
): Promise<void> {
  const def = k.catalog.character(id);
  if (!def) throw new AnimaeError("NOT_FOUND", `character ${id}`);
  const from = def.card.lod;
  if (LOD_RANK[to] <= LOD_RANK[from]) {
    throw new AnimaeError("ENTITY_INVALID", `LOD may only increase (from ${from} to ${to})`);
  }

  const tpl = findTemplateForLod(k, to, def);
  if (!tpl) throw new AnimaeError("NOT_FOUND", `no character template for LOD ${to}`);

  const schema = templateFieldsSchema(tpl.fields);
  const language = k.i18n.outputLocale ?? def.card.identity.language ?? k.authored.world.language;
  const segments: import("../ports.ts").PromptSegments = {
    static: [
      k.authored.world.rules_text && `World rules:\n${k.authored.world.rules_text}`,
      `Output language: ${language}`,
      tpl.guidance && `Template guidance:\n${tpl.guidance}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
    semiStatic: `Current character JSON:\n${JSON.stringify(stripCharacterForPrompt(def), null, 2)}`,
    dynamic: `Promote from LOD ${from} to ${to}. Only provide fields missing for the target LOD.`,
    user: `Complete the character to LOD ${to}.`,
  };

  const port = to === "principal" ? k.models.s2 : k.models.s1;
  const patch = schema.parse(
    await port.object({
      label: "generate",
      segments,
      schema,
      maxOutputTokens: 4096,
    }),
  ) as Record<string, unknown>;

  const merged = mergeCharacterPatch(def, patch, to);
  const data = JSON.parse(JSON.stringify(merged)) as Record<string, import("../types.ts").JsonValue>;

  await k.emit(
    [
      {
        kind: "character.promoted",
        id,
        from,
        to,
        data,
        source: why?.source ?? "entities.promote",
        because: why?.because ?? [],
      },
    ],
    { source: why?.source },
  );
}

function findTemplateForLod(k: Kernel, lod: Lod, def: CharacterDef): Template | undefined {
  const templates = Object.values(k.authored.templates.character);
  const withLod = templates.filter((t) => (t.lod ?? "extra") === lod);
  if (withLod.length === 1) return withLod[0];
  const x = def.card.x_import as { template?: string } | undefined;
  if (x?.template) return k.authored.templates.character[x.template];
  return withLod[0] ?? templates[0];
}

function stripCharacterForPrompt(def: CharacterDef): unknown {
  return {
    id: def.id,
    card: def.card,
    persona: def.persona,
    traits: def.traits,
    tracks: def.tracks,
    goals: def.goals,
    secrets: def.secrets,
    relations: def.relations,
  };
}

function mergeCharacterPatch(def: CharacterDef, patch: Record<string, unknown>, to: Lod): CharacterDef {
  const out = JSON.parse(JSON.stringify(def)) as CharacterDef;
  if (patch.identity && typeof patch.identity === "object") {
    out.card.identity = { ...out.card.identity, ...(patch.identity as object) };
  }
  if (patch.constraints && typeof patch.constraints === "object") {
    out.card.constraints = { ...out.card.constraints, ...(patch.constraints as object) };
  }
  if (typeof patch.persona === "string") out.persona = patch.persona;
  if (patch.traits) out.traits = patch.traits as CharacterDef["traits"];
  if (patch.tracks) out.tracks = patch.tracks as CharacterDef["tracks"];
  if (patch.goals) out.goals = patch.goals as CharacterDef["goals"];
  if (patch.secrets) out.secrets = patch.secrets as CharacterDef["secrets"];
  if (patch.relations) out.relations = patch.relations as CharacterDef["relations"];
  out.card.lod = to;
  return out;
}

async function checkPromotions(k: Kernel, ids: CharacterId[]): Promise<void> {
  const policyRules = k.policy.characters?.lod?.promote ?? [];
  for (const id of ids) {
    const def = k.catalog.character(id);
    if (!def) continue;
    const from = def.card.lod;
    const to = nextLod(from);
    if (!to) continue;

    let should = false;
    const ctxBase = k.celContext({ self: id, extra: { anchor_ref: k.m.director.anchorsReferencing(id).length > 0 } });

    for (const rule of policyRules) {
      if (rule.from !== from || rule.to !== to) continue;
      if (k.rules.cel.bool(rule.when, ctxBase)) {
        should = true;
        break;
      }
    }

    const tpl = findTemplateForLod(k, to, def);
    if (tpl) {
      for (const pr of tpl.promote ?? []) {
        if (pr.to !== to) continue;
        if (pr.from !== undefined && pr.from !== from) continue;
        if (k.rules.cel.bool(pr.when, ctxBase)) {
          should = true;
          break;
        }
      }
    }

    if (should) await promoteCharacter(k, id, to, { source: "entities.checkPromotions" });
  }
}
