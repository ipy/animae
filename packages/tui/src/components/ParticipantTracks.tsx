import { Box, Text } from "ink";
import { useEngineContext } from "../context/engine-context.tsx";
import { useQuery } from "../hooks/use-query.ts";
import { useTheme } from "../hooks/use-theme.ts";
import { formatTierLabel, formatTrackLabel } from "../utils/tier-display.ts";
import { useTuiI18n } from "../i18n/context.tsx";
import { characterDisplayName } from "../utils/character-name.ts";

type TierMap = { self?: Record<string, string>; toward?: Record<string, Record<string, string>> };

export function ParticipantTracks() {
  const { locale } = useTuiI18n();
  const theme = useTheme();
  const { engine, viewer, displayName } = useEngineContext();
  const scene = useQuery("scene") as { participants?: string[] } | null;

  const participants = scene?.participants?.filter((p) => p !== "player") ?? [];
  if (participants.length === 0) return null;

  return (
    <Box flexDirection="column">
      {participants.map((id) => {
        const tiers = engine.query(viewer, `characters/${id}/tiers`) as TierMap | undefined;
        const towardPlayer = tiers?.toward?.player ?? tiers?.toward?.["player"];
        const selfTiers = tiers?.self;
        const lines: string[] = [];
        if (towardPlayer) {
          for (const [track, tierName] of Object.entries(towardPlayer)) {
            if (tierName == null || tierName === "") continue;
            lines.push(
              `${formatTrackLabel(track, locale)} ${formatTierLabel(String(tierName), locale)}`,
            );
          }
        }
        if (selfTiers) {
          for (const [track, tierName] of Object.entries(selfTiers)) {
            if (tierName == null || tierName === "") continue;
            lines.push(
              `${formatTrackLabel(track, locale)} ${formatTierLabel(String(tierName), locale)}`,
            );
          }
        }
        const label = characterDisplayName({ engine, viewer, displayName }, id) ?? id;
        return (
          <Box key={id} flexDirection="column" marginBottom={0}>
            <Text bold color={theme.colors.primary}>
              {label}
            </Text>
            {lines.length ? (
              lines.map((line) => (
                <Text key={line} dimColor>
                  · {line}
                </Text>
              ))
            ) : (
              <Text dimColor>· —</Text>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
