import { Box, Text } from "ink";
import { useAppState } from "../context/app-state-context.tsx";
import { useQuery } from "../hooks/use-query.ts";
import { useRuntimeMode } from "../hooks/use-runtime-mode.ts";
import { useTheme } from "../hooks/use-theme.ts";
import { useMouseContextOptional } from "../context/mouse-context.tsx";
import { useTuiI18n } from "../i18n/context.tsx";
import { modeIndicator } from "../utils/mode-display.ts";

export function Footer() {
  const { t } = useTuiI18n();
  const theme = useTheme();
  const { state } = useAppState();
  const budget = useQuery("budget") as Record<string, unknown> | null;
  const runtime = useRuntimeMode();

  const mouse = useMouseContextOptional();
  const hoverHint = mouse?.hoverHint;
  const budgetStr =
    budget && typeof budget === "object"
      ? Object.entries(budget)
          .slice(0, 3)
          .map(([k, v]) => `${k}:${String(v)}`)
          .join(" ")
      : "";
  const indicator = runtime ? modeIndicator(runtime.mode, runtime.models, runtime.pending) : undefined;
  // The router can serve a turn from a higher tier than the one the mode selects: show which one answered.
  const route = state.lastRoute;
  const selectedTier = runtime ? (runtime.mode.s2Tier ?? runtime.models.s2Default) : undefined;
  const escalated =
    route?.render === "llm" && route.tier !== undefined && selectedTier !== undefined && route.tier !== selectedTier
      ? ` ↑${route.tier}`
      : "";
  const anyLlm = runtime ? runtime.mode.appraise === "llm" || runtime.mode.render === "llm" : false;

  return (
    <Box borderStyle={theme.border === "none" ? undefined : theme.border} borderColor={theme.colors.border} paddingX={1} justifyContent="space-between">
      {/* The hints give way on a narrow terminal; the mode indicator never does. */}
      <Box flexShrink={1}>
        <Text dimColor wrap="truncate-end">
          {t("footer.key_hints")}
          {hoverHint ? hoverHint : t("footer.mouse_hint")}
        </Text>
      </Box>
      <Box flexShrink={0} marginLeft={2}>
        <Text color={theme.colors.dim} wrap="truncate-end">
          {indicator ? <Text color={anyLlm ? theme.colors.primary : theme.colors.dim}>{indicator}</Text> : "—"}
          {escalated}
          {budgetStr ? ` · ${budgetStr}` : ""}
        </Text>
      </Box>
    </Box>
  );
}
