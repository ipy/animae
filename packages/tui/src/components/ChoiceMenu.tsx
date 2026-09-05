import { Box, Text } from "ink";
import { useAppState } from "../context/app-state-context.tsx";
import { useTheme } from "../hooks/use-theme.ts";
import { Clickable } from "./Clickable.tsx";
import { useTurn } from "../hooks/use-turn.ts";

export function ChoiceMenu() {
  const { state } = useAppState();
  const theme = useTheme();
  const { submit } = useTurn();
  const choices = state.choices;
  if (!choices || choices.choices.length === 0) return null;

  return (
    <Box flexDirection="column" marginY={0}>
      {choices.choices.map((c, i) => {
        const selected = i === choices.selected;
        return (
          <Clickable
            key={c.id}
            hint={c.text}
            focused={selected}
            onPress={() => void submit("", c.id)}
          >
            <Text color={selected ? theme.colors.player : theme.colors.dim}>
              {selected ? "▸ " : "  "}
              {i + 1}. {c.text}
            </Text>
          </Clickable>
        );
      })}
    </Box>
  );
}
