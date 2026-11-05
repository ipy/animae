import { Box, Text } from "ink";
import { useRuntimeMode } from "../hooks/use-runtime-mode.ts";
import { useTheme } from "../hooks/use-theme.ts";
import { useTuiI18n } from "../i18n/context.tsx";
import { formatMode, modePanelRows, type ModeRow } from "../utils/mode-display.ts";
import { Overlay } from "./Overlay.tsx";

/** F6: which backend serves S1 and S2, with the presets and S2 tiers to switch to. */
export function ModePanel({ selected }: { selected: number }) {
  const { t, has } = useTuiI18n();
  const theme = useTheme();
  const runtime = useRuntimeMode();

  if (!runtime) {
    return (
      <Overlay title={t("mode.title")} width={78} height={12}>
        <Text dimColor>{t("mode.unsupported")}</Text>
      </Overlay>
    );
  }

  const { mode, pending, models, switchAt } = runtime;
  const rows = modePanelRows(mode, models);
  const cursor = Math.min(selected, rows.length - 1);
  const presetRows = rows.filter((r): r is Extract<ModeRow, { kind: "preset" }> => r.kind === "preset");
  const tierRows = rows.filter((r): r is Extract<ModeRow, { kind: "tier" }> => r.kind === "tier");

  const marker = (row: ModeRow) => (rows[cursor]?.id === row.id ? "›" : " ");
  const tag = (row: ModeRow) => (row.current ? ` (${t("mode.current")})` : "");

  return (
    <Overlay title={t("mode.title")} width={78} height={tierRows.length > 0 ? 22 : 16}>
      <Text>
        <Text bold>{t("mode.now", { mode: `[${formatMode(mode, models)}]` })}</Text>
        {pending ? <Text color={theme.colors.warning}> → [{formatMode(pending, models)}]</Text> : null}
      </Text>
      {pending ? (
        <Text color={theme.colors.warning}>{t("mode.takes_effect_after_turn")}</Text>
      ) : switchAt === "turn_boundary" ? (
        <Text dimColor>{t("mode.switch_at_boundary")}</Text>
      ) : null}
      <Box flexDirection="column" marginTop={1}>
        <Text bold>{t("mode.presets")}</Text>
        {presetRows.map((row) => {
          const key = `mode.preset.${row.preset}`;
          const label = has(key) ? t(key) : row.preset;
          return (
            <Text key={row.id} dimColor={!row.available} color={rows[cursor]?.id === row.id ? theme.colors.primary : undefined}>
              {marker(row)} {label}
              {tag(row)}
              {row.available ? "" : ` — ${t("mode.unavailable")}`}
            </Text>
          );
        })}
      </Box>
      {tierRows.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>{t("mode.tiers")}</Text>
          {tierRows.map((row) => (
            <Text key={row.id} dimColor={!row.available} color={rows[cursor]?.id === row.id ? theme.colors.primary : undefined}>
              {marker(row)} {row.tier.id} <Text dimColor>{row.tier.model}</Text>
              {row.tier.tags.length > 0 ? <Text dimColor> [{row.tier.tags.join(", ")}]</Text> : null}
              {tag(row)}
              {row.available ? "" : ` — ${t("mode.tier_needs_model")}`}
            </Text>
          ))}
        </Box>
      ) : null}
      <Box marginTop={1}>
        <Text dimColor>{t("mode.hint")}</Text>
      </Box>
    </Overlay>
  );
}
