import { Box, Text } from "ink";
import { useQuery } from "../hooks/use-query.ts";
import { useTheme } from "../hooks/use-theme.ts";
import { useTuiI18n } from "../i18n/context.tsx";

export function FieldList() {
  const { t } = useTuiI18n();
  const theme = useTheme();
  const fields = useQuery("world/fields") as Array<{ id?: string; name?: string }> | null;

  if (!fields || !Array.isArray(fields) || fields.length === 0) {
    return <Text dimColor>{t("field_list.empty")}</Text>;
  }

  return (
    <Box flexDirection="column">
      {fields.slice(0, 12).map((f, i) => (
        <Text key={f.id ?? String(i)} color={theme.colors.narration}>
          · {f.name ?? f.id ?? t("field_list.fallback_name")}
        </Text>
      ))}
    </Box>
  );
}
