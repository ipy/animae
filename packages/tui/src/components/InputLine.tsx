import { Box, Text } from "ink";
import { useMemo } from "react";
import { useTheme } from "../hooks/use-theme.ts";
import { columnAtGraphemeIndex, displayWidth, truncateToWidth } from "../utils/display-width.ts";
import { graphemeCount, graphemes, sliceGraphemes } from "../utils/grapheme.ts";

export function InputLine({
  width,
  value,
  cursor,
  active,
}: {
  width: number;
  value: string;
  cursor: number;
  active: boolean;
}) {
  const theme = useTheme();
  const maxCols = Math.max(10, width - 4);

  const { before, at, after } = useMemo(() => {
    const total = graphemeCount(value);
    const idx = Math.max(0, Math.min(cursor, total));
    let startG = 0;
    const colAtCursor = columnAtGraphemeIndex(value, idx);
    if (colAtCursor >= maxCols) {
      startG = graphemeIndexForColumnWindow(value, colAtCursor - maxCols + 1);
    }
    const gs = graphemes(sliceGraphemes(value, startG));
    const relCursor = idx - startG;
    const beforeText = gs.slice(0, relCursor).join("");
    const atG = gs[relCursor] ?? " ";
    const afterText = gs.slice(relCursor + 1).join("");
    const trimmedBefore = truncateToWidth(beforeText, maxCols, "");
    const trimmedAfter = truncateToWidth(afterText, maxCols - displayWidth(trimmedBefore) - 1, "");
    return { before: trimmedBefore, at: atG, after: trimmedAfter };
  }, [value, cursor, maxCols]);

  return (
    <Box>
      <Text color={theme.colors.player}>{"> "}</Text>
      <Text>
        {before}
        {active ? <Text inverse>{at}</Text> : at}
        {after}
      </Text>
      {!active ? <Text dimColor> (Tab to focus)</Text> : null}
    </Box>
  );
}

function graphemeIndexForColumnWindow(text: string, targetCol: number): number {
  let w = 0;
  const gs = graphemes(text);
  for (let i = 0; i < gs.length; i++) {
    w += displayWidth(gs[i]!);
    if (w >= targetCol) return i + 1;
  }
  return gs.length;
}
