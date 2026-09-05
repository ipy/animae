import { useKeymapContext } from "../context/keymap-context.tsx";

export function useKeymap() {
  return useKeymapContext();
}
