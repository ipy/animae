import { Box, Text } from "ink";
import { useMemo } from "react";
import { useActionRunner } from "../context/action-runner-context.tsx";
import { listToolbarActions } from "../utils/action-list.ts";
import { Button } from "./Button.tsx";
import { useTheme } from "../hooks/use-theme.ts";
import { useTuiI18n } from "../i18n/context.tsx";
import { resolveText } from "../utils/resolve-text.ts";

export function ActionToolbar({ width }: { width: number }) {
  const { t, locale } = useTuiI18n();
  const theme = useTheme();
  const { actions, actionContext, runAction } = useActionRunner();
  const visible = useMemo(
    () => listToolbarActions(actions, actionContext).slice(0, Math.max(3, Math.floor(width / 14))),
    [actions, actionContext, width, locale],
  );
  if (visible.length === 0) return null;

  return (
    <Box paddingX={1} columnGap={1} flexWrap="wrap">
      <Text dimColor>{t("toolbar.actions")} </Text>
      {visible.map((a) => (
        <Button
          key={a.id}
          label={resolveText(a.label)}
          hotkey={a.hotkey}
          hint={a.hint ? resolveText(a.hint) : undefined}
          onPress={() => void runAction(a)}
        />
      ))}
      <Text color={theme.colors.dim}>{t("toolbar.command_hint")}</Text>
    </Box>
  );
}
