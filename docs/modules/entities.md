# Module: `entities`

## Purpose

Runtime entity generation, LOD promotion, and SillyTavern card import/export ([6.3](../spec.md#63-dynamic-generation)–[6.4](../spec.md#64-import-and-export)).

## Public API

- `createEntityService(kernel): EntityService`
  - `generate({ kind, template, hints? })` — S1/S2 (`template.lod === principal` → S2), prompt includes world language ([Section 8](../spec.md#8-cognitive-pipeline)), validates template zod schema, adjudicates id/uniqueness/defaults/LOD, persists under `timelines/<branch>/entities/`, emits `entity.created`.
  - `promote(id, to)` — one LOD step up only; model fill via target LOD template; emits `character.promoted` with optional `data` payload.
  - `checkPromotions(ids)` — policy `characters.lod.promote` + template `promote` CEL rules (`anchor_ref` extra via director).
  - `importCard(file)` — ST V2/V3 JSON, PNG (`chara`/`ccv3`), or `.acard.jsonl`.
  - `exportCard(id)` — `exports/<id>.acard.jsonl` manifest + file lines.
- `descriptorToZod`, `templateFieldsSchema`, `importAcard`, `exportAcard`, PNG helpers (tests/tools).

## Decisions

- Duplicate entity ids at generate time are rejected (`ENTITY_DUPLICATE`); import uses `-2`, `-3`, … suffixes when the slug exists.
- ST `character_book` keys → CEL `when` combining tag match and `event.text.lowerAscii().contains(...)`.
- Card import stores unmapped ST fields under `x_import` in `card.md` frontmatter.

## Edge cases

- PNG: prefers `ccv3` over `chara` when both chunks exist.
- Promotion template pick: match `template.lod`, else `x_import.template`, else first character template.

## Name references in authored prose

Use `{{name:<characterId>}}` in markdown/YAML/strings when text must address a character by their current display name (card name or runtime nickname from `setAlias`). Expansion is implemented in `entities/name-refs.ts` and wired through `promptText`, `prepareAuthoredProse`, and `Engine.display.resolve(..., { localizeNames: true })` for UI in another language than card prose. Policy prompt templates may still use `{{ name }}` / `{{ canonical_name }}` (speaker-scoped). Cross-language render prompts may add a name glossary using `character.<id>.name|nickname` string-table keys (nickname field on the card when present). `animae validate` warns on unknown ids (`NAME_REF_UNKNOWN`). Alias labels must not contain `{{` or start with `$t:`.
