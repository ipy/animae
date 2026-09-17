import { Box, Text } from "ink";
import { useAppState } from "../context/app-state-context.tsx";
import { useQuery } from "../hooks/use-query.ts";
import { useTheme } from "../hooks/use-theme.ts";
import { useMouseContextOptional } from "../context/mouse-context.tsx";
import { useTuiI18n } from "../i18n/context.tsx";

export function Footer() {
  const { t } = useTuiI18n();
  const theme = useTheme();
  const { state } = useAppState();
  const budget = useQuery("budget") as Record<string, unknown> | null;

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
        {t("footer.key_hints")}
        {hoverHint ? hoverHint : t("footer.mouse_hint")}
      </Text>
      <Text color={theme.colors.dim}>
        {route} {budgetStr ? `· ${budgetStr}` : ""}
      </Text>
    </Box>
  );
}
