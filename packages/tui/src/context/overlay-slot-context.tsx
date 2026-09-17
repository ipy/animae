import { createContext, useContext, type ReactNode } from "react";

/**
 * Modal content (help, palette, prompts, ...) that the layout shows in place of its main region.
 *
 * Rendering a modal below the layout would make the frame taller than the terminal: the alternate screen
 * cannot scroll, so the top of the layout would be pushed out of view while the modal is open.
 */
const OverlaySlotContext = createContext<ReactNode>(null);

export const OverlaySlotProvider = OverlaySlotContext.Provider;

export function useOverlaySlot(): ReactNode {
  return useContext(OverlaySlotContext);
}
