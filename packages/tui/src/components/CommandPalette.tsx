import { Box, Text } from "ink";
import { useMemo } from "react";
import { useAppState } from "../context/app-state-context.tsx";
import { useActionRunner } from "../context/action-runner-context.tsx";
import { buildPaletteEntries } from "../utils/action-list.ts";
import { Overlay } from "./Overlay.tsx";
import { Clickable } from "./Clickable.tsx";
import { useTheme } from "../hooks/use-theme.ts";
import { runCommandLine } from "../commands/builtin.ts";
import { useRunner } from "../context/runner-context.tsx";
import { useTuiI18n } from "../i18n/context.tsx";

export function CommandPalette() {
  const { t } = useTuiI18n();
  const theme = useTheme();
  const { state, dispatch, config, commandApi } = useAppState();
  const { actions, entityActions, actionContext, runAction, runEntityAction } = useActionRunner();
  const { onQuit } = useRunner();

  const entries = useMemo(
    () =>
      buildPaletteEntries(
        state.paletteQuery,
        actionContext,
        actions,
        entityActions,
        config.customCommands,
        state.focusTarget,
      ),
    [
      state.paletteQuery,
      actionContext,
      actions,
      entityActions,
      config.customCommands,
      state.focusTarget,
    ],
  );

  if (!state.paletteOpen) return null;

  const selected = Math.min(state.paletteIndex, Math.max(0, entries.length - 1));
  const window = entries.slice(Math.max(0, selected - 8), selected + 12);

  const activate = async (idx: number) => {
    const entry = entries[idx];
    if (!entry) return;
    dispatch({ type: "setPalette", open: false });
    if (entry.kind === "action" && entry.action) await runAction(entry.action);
    if (entry.kind === "entity" && entry.entityAction && state.focusTarget) {
      await runEntityAction(entry.entityAction, state.focusTarget);
    }
    if (entry.kind === "command" && entry.commandName) {
      const result = await runCommandLine(
        `:${entry.commandName}`,
        commandApi,
        config.customCommands,
      );
      if (result === "quit") onQuit();
    }
  };

  return (
    <Overlay title={t("palette.title")}>
      <Text dimColor>
        {t("palette.filter", { query: state.paletteQuery || t("palette.filter_all") })}
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {window.map((e, i) => {
          const idx = Math.max(0, selected - 8) + i;
          const active = idx === selected;
          return (
            <Clickable
              key={e.id}
              hint={e.hint}
              focused={active}
              onPress={() => void activate(idx)}
            >
              <Text color={active ? theme.colors.player : theme.colors.dim}>
                {active ? "▸ " : "  "}
                {e.label}
                {e.hint ? ` — ${e.hint}` : ""}
              </Text>
            </Clickable>
          );
        })}
      </Box>
    </Overlay>
  );
}
