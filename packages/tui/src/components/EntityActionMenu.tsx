import { Box, Text } from "ink";
import { useMemo } from "react";
import { useAppState } from "../context/app-state-context.tsx";
import { useActionRunner } from "../context/action-runner-context.tsx";
import { listEntityActions } from "../utils/action-list.ts";
import { Overlay } from "./Overlay.tsx";
import { Clickable } from "./Clickable.tsx";
import { useTheme } from "../hooks/use-theme.ts";

export function EntityActionMenu() {
  const theme = useTheme();
  const { state, dispatch } = useAppState();
  const { entityActions, actionContext, runEntityAction } = useActionRunner();
  const entityId = state.focusTarget;
  if (!state.entityMenuOpen || !entityId) return null;

  const actions = useMemo(
    () => listEntityActions(entityActions, actionContext, entityId),
    [entityActions, actionContext, entityId],
  );

  return (
    <Overlay title={`目标 · ${entityId}`}>
      <Text dimColor>Enter / 点击执行 · Esc 关闭</Text>
      <Box flexDirection="column" marginTop={1}>
        {actions.map((a) => (
          <Clickable
            key={a.id}
            hint={a.hint}
            onPress={() => {
              dispatch({ type: "setEntityMenu", open: false });
              void runEntityAction(a, entityId);
            }}
          >
            <Text color={theme.colors.primary}>
              {a.hotkey ? `[${a.hotkey}] ` : ""}
              {a.label}
            </Text>
          </Clickable>
        ))}
      </Box>
    </Overlay>
  );
}
