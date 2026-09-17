import { Box } from "ink";
import { Children, type ReactNode } from "react";

/**
 * Lay children out at their natural height, one below the other.
 *
 * Terminal frames have a fixed height. When the children are taller than their container, Yoga (Ink's layout
 * engine) shrinks every child that has `flexShrink: 1` - Ink's default - below its content, and the text of
 * the shrunk children is still painted from their top edge: neighbouring blocks end up printed over each other.
 * Children that refuse to shrink overflow cleanly instead, and the container's `overflow` clips them.
 */
export function Stack({ children }: { children: ReactNode }) {
  return (
    <>
      {Children.toArray(children).map((child, i) => (
        <Box key={i} flexShrink={0} flexDirection="column">
          {child}
        </Box>
      ))}
    </>
  );
}

/**
 * A region that keeps the size its parent gives it, whatever its content: what does not fit is clipped, never
 * painted over a neighbour. `anchor="end"` keeps the last child in view (a chat-style log, the newest line
 * next to the input) and clips the oldest; `anchor="start"` keeps the first child in view.
 */
export function Viewport({
  anchor = "start",
  children,
}: {
  anchor?: "start" | "end";
  children: ReactNode;
}) {
  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      flexShrink={1}
      overflow="hidden"
      justifyContent={anchor === "end" ? "flex-end" : "flex-start"}
    >
      <Stack>{children}</Stack>
    </Box>
  );
}
