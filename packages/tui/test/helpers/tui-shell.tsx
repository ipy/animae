import { useEffect, useRef, type ReactNode } from "react";
import { useInputDraftActions } from "../../src/context/input-draft-context.tsx";
import { EngineProvider } from "../../src/context/engine-context.tsx";
import {
  AppStateProvider,
  useAppState,
  type AppConfig,
  type AppStateAction,
} from "../../src/context/app-state-context.tsx";
import { ThemeProvider } from "../../src/context/theme-context.tsx";
import { MouseProvider } from "../../src/context/mouse-context.tsx";
import { KeymapProvider } from "../../src/context/keymap-context.tsx";
import { ActionRunnerProvider } from "../../src/context/action-runner-context.tsx";
import { InputDraftProvider } from "../../src/context/input-draft-context.tsx";
import { RunnerProvider } from "../../src/context/runner-context.tsx";
import { TuiI18nProvider } from "../../src/i18n/context.tsx";
import { createCueRegistry } from "../../src/cues/registry.ts";
import { loadTheme } from "../../src/theme/load.ts";
import { useTurn } from "../../src/hooks/use-turn.ts";
import type { Engine, EntityTuiAction, Theme, TranscriptEntry, TuiAction } from "../../src/types.ts";
import type { ThemePatch } from "../../src/theme/schema.ts";

/** The providers the transcript, footer and panels need, without the keyboard and layout of the full app. */
export function TuiTestShell({
  engine,
  theme,
  children,
}: {
  engine: Engine;
  theme?: Theme | ThemePatch;
  children: ReactNode;
}) {
  const resolved = loadTheme(theme);
  const config: AppConfig = {
    cueRegistry: createCueRegistry(),
    customCommands: {},
    panels: [],
    actions: [],
    entityActions: [],
    theme: resolved,
    nameHints: [],
  };
  return (
    <EngineProvider value={{ engine, viewer: "player", actor: "player" }}>
      <ThemeProvider theme={resolved}>
        <AppStateProvider engine={engine} viewer="player" actor="player" config={config} initialSceneId="scn_0001">
          <TuiI18nProvider initialLocale="en">
            <MouseProvider mouseOption={false}>{children}</MouseProvider>
          </TuiI18nProvider>
        </AppStateProvider>
      </ThemeProvider>
    </EngineProvider>
  );
}

/** Appends transcript entries once, as if a turn had produced them. */
export function FeedTranscript({ entries }: { entries: TranscriptEntry[] }) {
  const { dispatch } = useAppState();
  useEffect(() => {
    for (const entry of entries) dispatch({ type: "appendTranscript", entry });
  }, []);
  return null;
}

/** Submits one line through the real `useTurn` hook on mount. */
export function RunTurn({ text, onSettled }: { text: string; onSettled?: () => void }) {
  const { submit } = useTurn();
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void submit(text).then(() => onSettled?.());
  }, []);
  return null;
}

/** Runs `action` on mount, after `delayMs`. */
export function After({ delayMs, run }: { delayMs: number; run: (api: ReturnType<typeof useAppState>) => void }) {
  const api = useAppState();
  const latest = useRef(api);
  latest.current = api;
  useEffect(() => {
    const timer = setTimeout(() => run(latest.current), delayMs);
    return () => clearTimeout(timer);
  }, []);
  return null;
}

/** Sets the input draft store once on mount (AutocompletePopup reads this, not app-state draft). */
export function SetInputDraftOnMount({ value, cursor }: { value: string; cursor: number }) {
  const { setDraft } = useInputDraftActions();
  useEffect(() => {
    setDraft(value, cursor);
  }, []);
  return null;
}

/** Dispatches one or more actions once on mount. */
export function DispatchOnMount({ actions }: { actions: AppStateAction[] }) {
  const { dispatch } = useAppState();
  useEffect(() => {
    for (const a of actions) dispatch(a);
  }, []);
  return null;
}

/** Providers used by palette, toolbar, prompts, and overlay panels (not the full TuiApp keyboard shell). */
export function FullTuiTestShell({
  engine,
  theme,
  children,
  actions = [],
  entityActions = [],
  customCommands = {},
}: {
  engine: Engine;
  theme?: Theme | ThemePatch;
  children: ReactNode;
  actions?: TuiAction[];
  entityActions?: EntityTuiAction[];
  customCommands?: AppConfig["customCommands"];
}) {
  const resolved = loadTheme(theme);
  const config: AppConfig = {
    cueRegistry: createCueRegistry(),
    customCommands,
    panels: [],
    actions,
    entityActions,
    theme: resolved,
    nameHints: ["Mira", "Alex"],
  };
  return (
    <EngineProvider value={{ engine, viewer: "player", actor: "player" }}>
      <ThemeProvider theme={resolved}>
        <KeymapProvider>
          <AppStateProvider engine={engine} viewer="player" actor="player" config={config} initialSceneId="scn_0001">
            <TuiI18nProvider initialLocale="en">
              <RunnerProvider onQuit={() => {}}>
                <ActionRunnerProvider actions={actions} entityActions={entityActions}>
                  <InputDraftProvider>
                    <MouseProvider mouseOption={false}>{children}</MouseProvider>
                  </InputDraftProvider>
                </ActionRunnerProvider>
              </RunnerProvider>
            </TuiI18nProvider>
          </AppStateProvider>
        </KeymapProvider>
      </ThemeProvider>
    </EngineProvider>
  );
}
