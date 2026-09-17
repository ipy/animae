import { Box, type DOMElement } from "ink";
import { useId, useRef, type ReactNode } from "react";
import type { SgrMouseEvent } from "../input/mouse-sgr.ts";
import { useMouseTarget } from "../context/mouse-context.tsx";
import { useTheme } from "../hooks/use-theme.ts";

export interface ClickableProps {
  children: ReactNode;
  onPress?: (ev: SgrMouseEvent) => void;
  onWheel?: (ev: SgrMouseEvent) => void;
  hint?: string;
  disabled?: boolean;
  focused?: boolean;
  minWidth?: number;
  /**
   * Make the wrapper claim all the space its parent offers and clip what does not fit, so a large region
   * (the transcript) keeps its bounds instead of growing with its content.
   */
  fill?: boolean;
  /** Draw the hover/press frame (default). Large regions turn it off: a frame would resize their content. */
  frame?: boolean;
}

export function Clickable({
  children,
  onPress,
  onWheel,
  hint,
  disabled,
  focused,
  minWidth,
  fill,
  frame = true,
}: ClickableProps) {
  const theme = useTheme();
  const ref = useRef<DOMElement>(null);
  const id = useId();

  const { hover, pressed } = useMouseTarget(`click-${id}`, ref, {
    disabled,
    hint,
    wheel: onWheel !== undefined,
    onEvent: (ev) => {
      if (disabled) return;
      if (ev.button === "wheelUp" || ev.button === "wheelDown") {
        onWheel?.(ev);
        return;
      }
      if (ev.kind === "press" && ev.button === "left") onPress?.(ev);
      if (ev.kind === "press" && ev.button === "right") onPress?.(ev);
    },
  });

  const borderColor = !frame
    ? undefined
    : focused
      ? theme.colors.player
      : pressed
        ? theme.colors.primary
        : hover
          ? theme.colors.dim
          : undefined;

  return (
    <Box
      ref={ref}
      minWidth={minWidth}
      {...(fill ? { flexGrow: 1, flexDirection: "column" as const, overflow: "hidden" as const } : {})}
      borderStyle={borderColor ? "single" : undefined}
      borderColor={borderColor}
    >
      {children}
    </Box>
  );
}
