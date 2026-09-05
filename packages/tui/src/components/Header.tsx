import { Box, Text } from "ink";
import { useQuery } from "../hooks/use-query.ts";
import { useEngineContext } from "../context/engine-context.tsx";
import { useTheme } from "../hooks/use-theme.ts";

export function Header() {
  const theme = useTheme();
  const { engine } = useEngineContext();
  const worldTime = useQuery("world/time") as { day?: number; minute?: number; hhmm?: string } | null;
  const chapter = useQuery("world/chapter") as string | null;
  const location = useQuery("world/location") as string | null;
  const timeline = useQuery("timeline") as { branch?: string } | null;
  const info = engine.info();

  const timeLabel =
    worldTime && typeof worldTime === "object" && worldTime.day != null
      ? `Day ${worldTime.day} ${worldTime.hhmm ?? `${worldTime.minute}m`}`
      : "—";

  const branch = timeline?.branch ?? info.branch ?? "—";

  return (
    <Box borderStyle={theme.border === "none" ? undefined : theme.border} borderColor={theme.colors.border} paddingX={1}>
      <Text color={theme.colors.primary}>
        {timeLabel} · {String(location ?? "—")} · {String(chapter ?? "—")} · {branch}
      </Text>
    </Box>
  );
}
