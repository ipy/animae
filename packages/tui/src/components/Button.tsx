import { Text } from "ink";
import type { ReactNode } from "react";
import { Clickable } from "./Clickable.tsx";
import { useTheme } from "../hooks/use-theme.ts";

export function Button({
  label,
  hotkey,
  onPress,
  hint,
  disabled,
  focused,
}: {
  label: string;
  hotkey?: string;
  onPress?: () => void;
  hint?: string;
  disabled?: boolean;
  focused?: boolean;
}) {
  const theme = useTheme();
  const text = hotkey ? `[${hotkey}] ${label}` : label;
  return (
    <Clickable
      hint={hint ?? label}
      disabled={disabled}
      focused={focused}
      onPress={() => onPress?.()}
    >
      <Text color={disabled ? theme.colors.dim : focused ? theme.colors.player : theme.colors.primary}>
        {text}
      </Text>
    </Clickable>
  );
}

export function ButtonRow({ children }: { children: ReactNode }) {
  return (
    <Text>
      {children}
    </Text>
  );
}
