import { Text } from "ink";
import { truncateToWidth } from "../utils/display-width.ts";
import { useTheme } from "../hooks/use-theme.ts";

export function TrackBar({
  label,
  value,
  max = 100,
  width = 16,
  valueLabel,
  hideNumeric,
}: {
  label: string;
  value: number;
  max?: number;
  width?: number;
  /** When set, shown instead of the raw numeric value (player visibility). */
  valueLabel?: string;
  hideNumeric?: boolean;
}) {
  const theme = useTheme();
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const filled = Math.round(pct * width);
  const bar = "█".repeat(filled) + "░".repeat(Math.max(0, width - filled));
  const name = truncateToWidth(label, 12);
  const suffix =
    valueLabel != null
      ? ` ${valueLabel}`
      : hideNumeric
        ? ""
        : ` ${Math.round(value)}`;
  return (
    <Text>
      <Text dimColor>{name} </Text>
      <Text color={theme.colors.primary}>{bar}</Text>
      {suffix ? <Text dimColor>{suffix}</Text> : null}
    </Text>
  );
}
