import { Box, Text, useWindowSize } from "ink";
import type { LayoutProps } from "../types.ts";
import { Header } from "../components/Header.tsx";
import { Footer } from "../components/Footer.tsx";
import { Transcript } from "../components/Transcript.tsx";
import { SidePanel } from "../components/SidePanel.tsx";
import { ChoiceMenu } from "../components/ChoiceMenu.tsx";
import { InputLine } from "../components/InputLine.tsx";
import { selectLayoutMode } from "../utils/layout-mode.ts";
import { TooSmall } from "../components/TooSmall.tsx";
import { useTheme } from "../hooks/use-theme.ts";
import { useAppState } from "../context/app-state-context.tsx";
import { ActionToolbar } from "../components/ActionToolbar.tsx";
import { AutocompletePopup } from "../components/AutocompletePopup.tsx";

export function DefaultLayout(props: LayoutProps) {
  const { columns, rows } = useWindowSize();
  const theme = useTheme();
  const { state, config } = useAppState();
  const HeaderComp = config.header ?? Header;
  const FooterComp = config.footer ?? Footer;
  const mode = selectLayoutMode(columns, rows);

  if (mode === "too-small") {
    return <TooSmall cols={columns} rows={rows} />;
  }

  const sideW =
    mode === "two-column"
      ? Math.max(20, Math.floor((columns * theme.sidePanel.widthPercent) / 100))
      : columns;
  const transcriptW = mode === "two-column" ? columns - sideW - 1 : columns;
  const inputActive = props.focus === "input" && !props.overlay && !state.choices;

  return (
    <Box flexDirection="column" height={rows}>
      <HeaderComp {...props} />
      <ActionToolbar width={columns} />
      {!props.hasScene ? (
        <Box paddingX={1}>
          <Text dimColor>{props.noSceneHint}</Text>
        </Box>
      ) : null}
      <Box flexGrow={1} flexDirection={mode === "two-column" ? "row" : "column"}>
        <Box width={transcriptW} flexDirection="column" flexGrow={1}>
          <Transcript width={transcriptW} rows={rows} />
        </Box>
        {mode === "two-column" ? <SidePanel width={sideW} /> : null}
      </Box>
      {state.turnError ? (
        <Box paddingX={1}>
          <Text color={theme.colors.warning}>⚠ {state.turnError}</Text>
        </Box>
      ) : null}
      <ChoiceMenu />
      <AutocompletePopup nameHints={config.nameHints} />
      <InputLine
        width={columns}
        value={state.inputDraft}
        cursor={state.inputCursor}
        active={inputActive}
      />
      <FooterComp {...props} />
    </Box>
  );
}

/** Spec §21.2 default layout component. */
export const defaultLayout = DefaultLayout;
