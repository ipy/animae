import { Box, Text } from "ink";
import { useQuery } from "../hooks/use-query.ts";
import { useTheme } from "../hooks/use-theme.ts";

export function FieldList() {
  const theme = useTheme();
  const fields = useQuery("world/fields") as Array<{ id?: string; name?: string }> | null;

  if (!fields || !Array.isArray(fields) || fields.length === 0) {
    return <Text dimColor>No visible fields</Text>;
  }

  return (
    <Box flexDirection="column">
      {fields.slice(0, 12).map((f, i) => (
        <Text key={f.id ?? String(i)} color={theme.colors.narration}>
          · {f.name ?? f.id ?? "field"}
        </Text>
      ))}
    </Box>
  );
}
