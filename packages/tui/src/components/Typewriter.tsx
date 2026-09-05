import { Text } from "ink";
import { useEffect, useMemo, useState } from "react";
import { graphemeCount, sliceGraphemes } from "../utils/grapheme.ts";
import { wrapToWidth } from "../utils/display-width.ts";
import { useTheme } from "../hooks/use-theme.ts";

export interface TypewriterProps {
  text: string;
  active: boolean;
  onComplete?: () => void;
  onProgress?: (visible: number, total: number) => void;
  skipSignal?: number;
  color?: string;
  wrapCols?: number;
}

export function Typewriter({
  text,
  active,
  onComplete,
  onProgress,
  skipSignal = 0,
  color,
  wrapCols,
}: TypewriterProps) {
  const theme = useTheme();
  const total = graphemeCount(text);
  const [visible, setVisible] = useState(active && theme.typewriter.enabled ? 0 : total);

  useEffect(() => {
    if (!active || !theme.typewriter.enabled) {
      setVisible(total);
      return;
    }
    setVisible(0);
  }, [text, active, theme.typewriter.enabled, total]);

  useEffect(() => {
    if (skipSignal > 0) setVisible(total);
  }, [skipSignal, total]);

  useEffect(() => {
    onProgress?.(visible, total);
    if (visible >= total) {
      onComplete?.();
      return;
    }
    if (!active || !theme.typewriter.enabled) return;
    const ms = Math.ceil(1000 / theme.typewriter.charsPerSecond);
    const t = setTimeout(() => setVisible((v) => Math.min(total, v + 1)), ms);
    return () => clearTimeout(t);
  }, [visible, total, active, theme.typewriter, onComplete, onProgress]);

  const shown = sliceGraphemes(text, 0, visible);
  const lines = useMemo(() => {
    if (!wrapCols || wrapCols < 2) return [shown];
    return wrapToWidth(shown, wrapCols);
  }, [shown, wrapCols]);

  return lines.map((line, i) => (
    <Text key={i} color={color}>
      {line}
    </Text>
  ));
}
