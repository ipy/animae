import { useMemo } from "react";
import { useEngineContext } from "../context/engine-context.tsx";
import { useQuery } from "./use-query.ts";
import { characterDisplayName } from "../utils/character-name.ts";

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

/** Display name for transcript: host resolver, else card identity when the viewer may read it, else the raw speaker. */
export function useSpeakerLabel(speaker?: string): string | undefined {
  const { engine, viewer, displayName } = useEngineContext();
  const characters = useQuery("characters") as CharacterRow[] | null;

  return useMemo(() => {
    if (!speaker) return undefined;
    const id = resolveCharacterId(speaker, characters ?? undefined) ?? speaker;
    return characterDisplayName({ engine, viewer, displayName }, id) ?? speaker;
  }, [speaker, characters, engine, viewer, displayName]);
}
