import { useMemo } from "react";
import { useEngineContext } from "../context/engine-context.tsx";
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
  const { engine, viewer } = useEngineContext();
  const characters = useQuery("characters") as CharacterRow[] | null;

  return useMemo(() => {
    if (!speaker) return theme.colors.npc;
    if (speaker === "player") return theme.colors.player;
    const id = resolveCharacterId(speaker, characters ?? undefined) ?? speaker;
    const identity = engine.query(viewer, `characters/${id}/identity`) as
      | { color?: string; name?: string }
      | undefined;
    const cardColor = identity?.color;
    if (typeof cardColor === "string" && cardColor.length > 0) return cardColor;
    return theme.colors.npc;
  }, [speaker, theme.colors.npc, theme.colors.player, characters, engine, viewer]);
}
