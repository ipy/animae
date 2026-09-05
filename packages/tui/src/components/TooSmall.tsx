import { Box, Text } from "ink";

export function TooSmall({ cols, rows }: { cols: number; rows: number }) {
  return (
    <Box flexDirection="column" alignItems="center" justifyContent="center" height={rows}>
      <Text bold color="yellow">
        Please enlarge your terminal
      </Text>
      <Text dimColor>
        Need at least 80×24; current {cols}×{rows}
      </Text>
    </Box>
  );
}
