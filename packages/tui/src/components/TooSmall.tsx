import { Box, Text } from "ink";
import { useTuiI18n } from "../i18n/context.tsx";

export function TooSmall({ cols, rows }: { cols: number; rows: number }) {
  const { t } = useTuiI18n();
  return (
    <Box flexDirection="column" alignItems="center" justifyContent="center" height={rows}>
      <Text bold color="yellow">
        {t("too_small.title")}
      </Text>
      <Text dimColor>{t("too_small.size", { cols, rows })}</Text>
    </Box>
  );
}
