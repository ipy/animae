export { runTui } from "./run-tui.ts";
export { defaultLayout } from "./layout/default-layout.tsx";
export * as components from "./components/index.ts";
export * as hooks from "./hooks/index.ts";

export type {
  RunTuiOptions,
  Theme,
  Keymap,
  KeyAction,
  CueRenderer,
  CueCtx,
  LayoutProps,
  CommandApi,
  CustomCommand,
  SidePanelSection,
  TuiAction,
  EntityTuiAction,
  ActionContext,
  ActionArgField,
  ResolvableText,
} from "./types.ts";

export { runCommandLine } from "./commands/builtin.ts";

export { loadTheme } from "./theme/load.ts";
export { defaultTheme } from "./theme/defaults.ts";
export { defaultKeymap } from "./keymap/default.ts";
export { createCueRegistry } from "./cues/registry.ts";
export { createTuiI18n, tuiCatalogs } from "./i18n/tui-i18n.ts";
export { localizeError } from "@animae/i18n";
export { resolveText } from "./utils/resolve-text.ts";
export { selectLayoutMode } from "./utils/layout-mode.ts";
export { modeIndicator } from "./utils/mode-display.ts";
export type { LayoutMode } from "./utils/layout-mode.ts";
