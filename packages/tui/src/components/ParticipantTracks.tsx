import { Box, Text } from "ink";
import { useEngineContext } from "../context/engine-context.tsx";
import { useQuery } from "../hooks/use-query.ts";
import { useTheme } from "../hooks/use-theme.ts";
import { formatTierLabel, formatTrackLabel, inferZhLanguage } from "../utils/tier-display.ts";

type TierMap = { self?: Record<string, string>; toward?: Record<string, Record<string, string>> };

export function ParticipantTracks() {
  const theme = useTheme();
  const { engine, viewer } = useEngineContext();
  const scene = useQuery("scene") as { participants?: string[] } | null;
  const chapter = useQuery("world/chapter");
  const language = inferZhLanguage(chapter) ? "zh-CN" : "en";

  const participants = scene?.participants?.filter((p) => p !== "player") ?? [];
  if (participants.length === 0) return null;

  return (
    <Box flexDirection="column">
      {participants.map((id) => {
        const identity = engine.query(viewer, `characters/${id}/identity`) as
          | { name?: string }
          | undefined;
        const tiers = engine.query(viewer, `characters/${id}/tiers`) as TierMap | undefined;
        const towardPlayer = tiers?.toward?.player ?? tiers?.toward?.["player"];
        const selfTiers = tiers?.self;
        const lines: string[] = [];
        if (towardPlayer) {
          for (const [track, tierName] of Object.entries(towardPlayer)) {
            lines.push(
              `${formatTrackLabel(track, language)} ${formatTierLabel(String(tierName), language)}`,
            );
          }
        }
        if (selfTiers) {
          for (const [track, tierName] of Object.entries(selfTiers)) {
            lines.push(
              `${formatTrackLabel(track, language)} ${formatTierLabel(String(tierName), language)}`,
            );
          }
        }
        const label = identity?.name ?? id;
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
