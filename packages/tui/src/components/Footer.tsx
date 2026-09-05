import { Box, Text } from "ink";
import { useAppState } from "../context/app-state-context.tsx";
import { useQuery } from "../hooks/use-query.ts";
import { useTheme } from "../hooks/use-theme.ts";
import { useMouseContextOptional } from "../context/mouse-context.tsx";

export function Footer() {
  const theme = useTheme();
  const { state } = useAppState();
  const budgetDirect = useQuery("budget") as Record<string, unknown> | null;
  const budgetBeat = useQuery("director/beat/budget") as Record<string, unknown> | null;
  const budget = budgetDirect ?? budgetBeat;

  const mouse = useMouseContextOptional();
  const hoverHint = mouse?.hoverHint;
  const route = state.lastRoute ? state.lastRoute.toUpperCase() : "—";
  const budgetStr =
    budget && typeof budget === "object"
      ? Object.entries(budget)
          .slice(0, 3)
          .map(([k, v]) => `${k}:${String(v)}`)
          .join(" ")
      : "";

  return (
    <Box borderStyle={theme.border === "none" ? undefined : theme.border} borderColor={theme.colors.border} paddingX={1} justifyContent="space-between">
      <Text dimColor>
        F1 help · Ctrl+P palette · Tab complete · {hoverHint ? hoverHint : "Mouse · Shift+drag selects text"}
      </Text>
      <Text color={theme.colors.dim}>
        {route} {budgetStr ? `· ${budgetStr}` : ""}
      </Text>
    </Box>
  );
}
