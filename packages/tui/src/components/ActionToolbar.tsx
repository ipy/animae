import { Box, Text } from "ink";
import { useMemo } from "react";
import { useActionRunner } from "../context/action-runner-context.tsx";
import { listToolbarActions } from "../utils/action-list.ts";
import { Button } from "./Button.tsx";
import { useTheme } from "../hooks/use-theme.ts";

export function ActionToolbar({ width }: { width: number }) {
  const theme = useTheme();
  const { actions, actionContext, runAction } = useActionRunner();
  const visible = useMemo(
    () => listToolbarActions(actions, actionContext).slice(0, Math.max(3, Math.floor(width / 14))),
    [actions, actionContext, width],
  );
  if (visible.length === 0) return null;

  return (
    <Box paddingX={1} gap={1} flexWrap="wrap">
      <Text dimColor>动作 </Text>
      {visible.map((a) => (
        <Button
          key={a.id}
          label={a.label}
          hotkey={a.hotkey}
          hint={a.hint}
          onPress={() => void runAction(a)}
        />
      ))}
      <Text color={theme.colors.dim}> · Ctrl+P 命令</Text>
    </Box>
  );
}
