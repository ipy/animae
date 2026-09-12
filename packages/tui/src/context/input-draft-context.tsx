import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { mirrorPtyInputDraft } from "../input/pty-draft-mirror.ts";

export interface InputDraftActions {
  setDraft: (value: string, cursor: number) => void;
  clearDraft: () => void;
  readDraft: () => { draft: string; cursor: number };
}

type DraftSnapshot = { draft: string; cursor: number };

function createDraftStore() {
  let snapshot: DraftSnapshot = { draft: "", cursor: 0 };
  const listeners = new Set<() => void>();
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot(): DraftSnapshot {
      return snapshot;
    },
    setDraft(value: string, cursor: number) {
      snapshot = { draft: value, cursor };
      mirrorPtyInputDraft(value, cursor);
      for (const l of listeners) l();
    },
    clearDraft() {
      snapshot = { draft: "", cursor: 0 };
      mirrorPtyInputDraft("", 0);
      for (const l of listeners) l();
    },
    readDraft() {
      return snapshot;
    },
  };
}

const DraftStoreContext = createContext<ReturnType<typeof createDraftStore> | null>(null);
const DraftActionsContext = createContext<InputDraftActions | null>(null);

export function InputDraftProvider({ children }: { children: ReactNode }) {
  const store = useMemo(() => createDraftStore(), []);
  const actions = useMemo<InputDraftActions>(
    () => ({
      setDraft: (value, cursor) => store.setDraft(value, cursor),
      clearDraft: () => store.clearDraft(),
      readDraft: () => store.readDraft(),
    }),
    [store],
  );
  return (
    <DraftStoreContext.Provider value={store}>
      <DraftActionsContext.Provider value={actions}>{children}</DraftActionsContext.Provider>
    </DraftStoreContext.Provider>
  );
}

export function useInputDraftActions(): InputDraftActions {
  const ctx = useContext(DraftActionsContext);
  if (!ctx) throw new Error("useInputDraftActions outside InputDraftProvider");
  return ctx;
}

export function useInputDraftDisplay(): DraftSnapshot {
  const store = useContext(DraftStoreContext);
  if (!store) throw new Error("useInputDraftDisplay outside InputDraftProvider");
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

export function useInputDraft(): DraftSnapshot & InputDraftActions {
  return { ...useInputDraftDisplay(), ...useInputDraftActions() };
}
