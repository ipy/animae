import { useMemo } from "react";
import { useQuery } from "./use-query.ts";
import { useTheme } from "./use-theme.ts";

type CharacterRow = { id?: string; name?: string };

function resolveCharacterId(
  speaker: string,
  rows: CharacterRow[] | null | undefined,
): string | undefined {
  if (!rows?.length) return undefined;
  const direct = rows.find((c) => c.id === speaker);
  if (direct?.id) return direct.id;
  const byName = rows.find((c) => c.name === speaker);
  return byName?.id;
}

/** Theme color for a dialogue speaker (card `color` when exposed via query). */
export function useSpeakerColor(speaker?: string): string {
  const theme = useTheme();
  const characters = useQuery("characters") as CharacterRow[] | null;

  const resolvedId = useMemo(() => {
    if (!speaker || speaker === "player") return undefined;
    return resolveCharacterId(speaker, characters ?? undefined) ?? speaker;
  }, [speaker, characters]);

  const identityQueryPath = resolvedId ? `characters/${resolvedId}/identity` : "scene";
  const identityRow = useQuery(identityQueryPath) as { color?: string; name?: string } | undefined;

  return useMemo(() => {
    if (!speaker) return theme.colors.npc;
    if (speaker === "player") return theme.colors.player;
    if (!resolvedId) return theme.colors.npc;
    const cardColor = identityRow?.color;
    if (typeof cardColor === "string" && cardColor.length > 0) return cardColor;
    return theme.colors.npc;
  }, [speaker, theme.colors.npc, theme.colors.player, resolvedId, identityRow]);
}
