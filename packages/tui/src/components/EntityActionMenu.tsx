import { Box, Text } from "ink";
import { useMemo } from "react";
import { useAppState } from "../context/app-state-context.tsx";
import { useActionRunner } from "../context/action-runner-context.tsx";
import { listEntityActions } from "../utils/action-list.ts";
import { Overlay } from "./Overlay.tsx";
import { Clickable } from "./Clickable.tsx";
import { useTheme } from "../hooks/use-theme.ts";
import { useTuiI18n } from "../i18n/context.tsx";
import { resolveText } from "../utils/resolve-text.ts";

export function EntityActionMenu() {
  const { t, locale } = useTuiI18n();
  const theme = useTheme();
  const { state, dispatch } = useAppState();
  const { entityActions, actionContext, runEntityAction } = useActionRunner();
  const entityId = state.focusTarget;
  const actions = useMemo(
    () => (entityId ? listEntityActions(entityActions, actionContext, entityId) : []),
    [entityActions, actionContext, entityId, locale],
  );
  if (!state.entityMenuOpen || !entityId) return null;

  return (
    <Overlay title={t("entity_menu.title", { entityId })}>
      <Text dimColor>{t("entity_menu.hint")}</Text>
      <Box flexDirection="column" marginTop={1}>
        {actions.map((a) => (
          <Clickable
            key={a.id}
            hint={a.hint ? resolveText(a.hint) : undefined}
            onPress={() => {
              dispatch({ type: "setEntityMenu", open: false });
              void runEntityAction(a, entityId);
            }}
          >
            <Text color={theme.colors.primary}>
              {a.hotkey ? `[${a.hotkey}] ` : ""}
              {resolveText(a.label)}
            </Text>
          </Clickable>
        ))}
      </Box>
    </Overlay>
  );
}
