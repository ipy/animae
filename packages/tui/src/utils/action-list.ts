import { builtinCommands } from "../commands/builtin.ts";
import type { CustomCommand, EntityTuiAction, TuiAction } from "../types.ts";
import type { ActionContext } from "../types.ts";
import { fuzzyRank } from "./fuzzy-match.ts";
import { resolveText } from "./resolve-text.ts";

export interface PaletteEntry {
  id: string;
  label: string;
  hint?: string;
  kind: "action" | "command" | "entity";
  action?: TuiAction;
  entityAction?: EntityTuiAction;
  commandName?: string;
}

type PaletteI18n = {
  t: (key: string, params?: Record<string, string | number>) => string;
  has: (key: string) => boolean;
};

function commandDescription(name: string, cmd: CustomCommand, i18n: PaletteI18n): string {
  const builtinKey = `command.desc.${name}`;
  if (i18n.has(builtinKey)) return i18n.t(builtinKey);
  const raw = resolveText(cmd.description);
  if (i18n.has(raw)) return i18n.t(raw);
  return raw;
}

export function listToolbarActions(actions: TuiAction[], ctx: ActionContext): TuiAction[] {
  return actions.filter((a) => a.toolbar !== false && (!a.when || a.when(ctx)));
}

export function listEntityActions(
  entityActions: EntityTuiAction[],
  ctx: ActionContext,
  entityId: string,
): EntityTuiAction[] {
  return entityActions.filter((a) => !a.when || a.when(ctx, entityId));
}

export function buildPaletteEntries(
  query: string,
  ctx: ActionContext,
  actions: TuiAction[],
  entityActions: EntityTuiAction[],
  commands: Record<string, CustomCommand>,
  focusTarget: string | undefined,
  i18n: PaletteI18n,
): PaletteEntry[] {
  const entries: PaletteEntry[] = [];

  for (const a of actions) {
    if (a.palette === false) continue;
    if (a.when && !a.when(ctx)) continue;
    entries.push({
      id: `action:${a.id}`,
      label: resolveText(a.label),
      hint: a.hint ? resolveText(a.hint) : undefined,
      kind: "action",
      action: a,
    });
  }

  if (focusTarget) {
    for (const a of listEntityActions(entityActions, ctx, focusTarget)) {
      entries.push({
        id: `entity:${a.id}`,
        label: `${resolveText(a.label)} (${focusTarget})`,
        hint: a.hint ? resolveText(a.hint) : undefined,
        kind: "entity",
        entityAction: a,
      });
    }
  }

  const cmdMap = { ...builtinCommands, ...commands };
  for (const [name, cmd] of Object.entries(cmdMap)) {
    entries.push({
      id: `cmd:${name}`,
      label: `:${name}`,
      hint: commandDescription(name, cmd, i18n),
      kind: "command",
      commandName: name,
    });
  }

  if (!query.trim()) return entries;
  return fuzzyRank(query, entries, (e) => `${e.label} ${e.hint ?? ""} ${e.id}`);
}

export function autocompleteSuggestions(
  draft: string,
  commands: Record<string, CustomCommand>,
  nameHints: string[],
): string[] {
  const trimmed = draft.trimStart();
  if (trimmed.startsWith(":")) {
    const partial = trimmed.slice(1).toLowerCase();
    const names = Object.keys({ ...builtinCommands, ...commands });
    return names.filter((n) => n.startsWith(partial)).map((n) => `:${n}`);
  }
  const q = trimmed.toLowerCase();
  if (!q) return [];
  return nameHints.filter((n) => n.toLowerCase().includes(q)).slice(0, 12);
}
