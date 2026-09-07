import { Box, Text, useWindowSize } from "ink";
import { useMemo } from "react";
import { useAppState } from "../context/app-state-context.tsx";
import { useInputDraftActions, useInputDraftDisplay } from "../context/input-draft-context.tsx";
import { autocompleteSuggestions } from "../utils/action-list.ts";
import { Clickable } from "./Clickable.tsx";
import { useTheme } from "../hooks/use-theme.ts";
import { graphemeCount } from "../utils/grapheme.ts";

export function AutocompletePopup({ nameHints }: { nameHints: string[] }) {
  const theme = useTheme();
  const { state, dispatch, config } = useAppState();
  const { draft } = useInputDraftDisplay();
  const { setDraft } = useInputDraftActions();
  const items = useMemo(
    () =>
      state.autocompleteOpen
        ? autocompleteSuggestions(draft, config.customCommands, nameHints)
        : [],
    [state.autocompleteOpen, draft, nameHints, config.customCommands],
  );

  const { rows } = useWindowSize();
  const maxItems = rows < 28 ? 4 : 8;

  if (!state.autocompleteOpen || items.length === 0) return null;

  const pick = (line: string) => {
    dispatch({ type: "setAutocomplete", open: false });
    const next = line.endsWith(" ") ? line : `${line} `;
    setDraft(next, graphemeCount(next));
  };

  return (
    <Box flexDirection="column" paddingX={1} marginBottom={0}>
      {items.slice(0, maxItems).map((item, i) => (
        <Clickable key={item} hint={item} focused={i === state.autocompleteIndex} onPress={() => pick(item)}>
          <Text color={i === state.autocompleteIndex ? theme.colors.player : theme.colors.dim}>
            {item}
          </Text>
        </Clickable>
      ))}
    </Box>
  );
}

/** Apply Tab autocomplete — returns true if handled. */
export function applyTabAutocomplete(
  state: import("../context/app-state-context.tsx").AppState,
  dispatch: import("react").Dispatch<import("../context/app-state-context.tsx").AppStateAction>,
  nameHints: string[],
  commands: Record<string, import("../types.ts").CustomCommand> = {},
  setDraft?: (value: string, cursor: number) => void,
  draft: string = state.inputDraft,
): boolean {
  const items = autocompleteSuggestions(draft, commands, nameHints);
  if (items.length === 0) return false;
  const idx = state.autocompleteIndex % items.length;
  const pick = items[idx]!;
  const next = pick.endsWith(" ") ? pick : `${pick} `;
  if (setDraft) setDraft(next, graphemeCount(next));
  else dispatch({ type: "setInputDraft", value: next, cursor: graphemeCount(next) });
  dispatch({ type: "setAutocomplete", open: false });
  return true;
}

export function commandAutocompleteOnly(
  draft: string,
  custom: Record<string, import("../types.ts").CustomCommand>,
): string[] {
  return autocompleteSuggestions(draft, custom, []);
}
