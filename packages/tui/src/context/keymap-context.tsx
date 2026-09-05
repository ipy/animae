import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { KeyAction, Keymap } from "../types.ts";
import { defaultKeymap } from "../keymap/default.ts";

export interface KeymapContextValue {
  keymap: Required<Keymap>;
  bind: (action: KeyAction, keys: string[]) => void;
}

const KeymapContext = createContext<KeymapContextValue | undefined>(undefined);

export function KeymapProvider({
  keymap: initial,
  children,
}: {
  keymap?: Partial<Keymap>;
  children: ReactNode;
}) {
  const [overrides, setOverrides] = useState<Partial<Keymap>>({});
  const merged = useMemo(
    () => ({ ...defaultKeymap, ...initial, ...overrides }) as Required<Keymap>,
    [initial, overrides],
  );
  const bind = useCallback((action: KeyAction, keys: string[]) => {
    setOverrides((prev) => ({ ...prev, [action]: keys }));
  }, []);
  const value = useMemo(() => ({ keymap: merged, bind }), [merged, bind]);
  return <KeymapContext.Provider value={value}>{children}</KeymapContext.Provider>;
}

export function useKeymapContext(): KeymapContextValue {
  const ctx = useContext(KeymapContext);
  if (!ctx) return { keymap: defaultKeymap, bind: () => {} };
  return ctx;
}
