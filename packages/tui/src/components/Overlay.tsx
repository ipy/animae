import { Box, Text } from "ink";
import type { ReactNode } from "react";
import { useTheme } from "../hooks/use-theme.ts";
import { useTuiI18n } from "../i18n/context.tsx";
import { Stack } from "./Viewport.tsx";

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
  const { t } = useTuiI18n();
  return (
    <Box
      flexDirection="column"
      borderStyle={theme.border === "none" ? undefined : theme.border}
      borderColor={theme.colors.warning}
      width={width}
      height={height}
      paddingX={1}
      flexShrink={0}
      overflow="hidden"
    >
      <Text bold color={theme.colors.warning}>
        {title} ({t("overlay.close_hint")})
      </Text>
      {/* Rows keep their height: a long list is clipped at the frame, never printed over itself. */}
      <Box flexDirection="column" marginTop={1} flexGrow={1} overflow="hidden">
        <Stack>{children}</Stack>
      </Box>
    </Box>
  );
}
