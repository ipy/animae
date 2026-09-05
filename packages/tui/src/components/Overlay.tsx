import { Box, Text } from "ink";
import type { ReactNode } from "react";
import { useTheme } from "../hooks/use-theme.ts";

export function Overlay({
  title,
  children,
  width = 72,
  height,
}: {
  title: string;
  children: ReactNode;
  width?: number;
  height?: number;
}) {
  const theme = useTheme();
  return (
    <Box
      flexDirection="column"
      borderStyle={theme.border === "none" ? undefined : theme.border}
      borderColor={theme.colors.warning}
      width={width}
      height={height}
      paddingX={1}
    >
      <Text bold color={theme.colors.warning}>
        {title} (Esc to close)
      </Text>
      <Box flexDirection="column" marginTop={1} flexGrow={1}>
        {children}
      </Box>
    </Box>
  );
}
