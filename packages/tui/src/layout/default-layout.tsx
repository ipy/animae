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
import { useInputDraftDisplay } from "../context/input-draft-context.tsx";
import { ActionToolbar } from "../components/ActionToolbar.tsx";
import { AutocompletePopup } from "../components/AutocompletePopup.tsx";
import { useOverlaySlot } from "../context/overlay-slot-context.tsx";

function InputChrome({
  width,
  active,
  nameHints,
}: {
  width: number;
  active: boolean;
  nameHints: string[];
}) {
  const { draft, cursor } = useInputDraftDisplay();
  return (
    <>
      <AutocompletePopup nameHints={nameHints} />
      <InputLine width={width} value={draft} cursor={cursor} active={active} />
    </>
  );
}

export function DefaultLayout(props: LayoutProps) {
  const { columns, rows } = useWindowSize();
  const theme = useTheme();
  const { state, config } = useAppState();
  const HeaderComp = config.header ?? Header;
  const FooterComp = config.footer ?? Footer;
  const mode = selectLayoutMode(columns, rows);
  const modal = useOverlaySlot();

  if (mode === "too-small") {
    return <TooSmall cols={columns} rows={rows} />;
  }

  const sideW =
    mode === "two-column"
      ? Math.max(20, Math.floor((columns * theme.sidePanel.widthPercent) / 100))
      : columns;
  const transcriptW = mode === "two-column" ? columns - sideW - 1 : columns;
  // Choices can stay visible while the player types free text (focus === "input").
  const inputActive = props.focus === "input" && !props.overlay;

  // The frame is exactly as tall as the terminal. The chrome (header, toolbar, input, footer) keeps its natural
  // height and only the main region gives way, so a long transcript or panel is clipped inside its own area
  // instead of being painted over the input line.
  return (
    <Box flexDirection="column" height={rows}>
      <Box flexShrink={0} flexDirection="column">
        <HeaderComp {...props} />
        <ActionToolbar width={columns} />
      </Box>
      {!props.hasScene ? (
        <Box paddingX={1} flexShrink={0}>
          <Text dimColor>{props.noSceneHint}</Text>
        </Box>
      ) : null}
      <Box
        flexGrow={1}
        flexShrink={1}
        flexBasis={0}
        overflow="hidden"
        flexDirection={mode === "two-column" && !modal ? "row" : "column"}
      >
        {modal ? (
          modal
        ) : (
          <>
            <Box
              width={transcriptW}
              flexDirection="column"
              flexGrow={1}
              overflow="hidden"
              paddingRight={mode === "two-column" ? 1 : 0}
            >
              <Transcript width={transcriptW} rows={rows} />
            </Box>
            {mode === "two-column" ? <SidePanel width={sideW} /> : null}
          </>
        )}
      </Box>
      {state.turnError ? (
        <Box paddingX={1} flexShrink={0}>
          <Text color={theme.colors.warning}>⚠ {state.turnError}</Text>
        </Box>
      ) : null}
      <Box flexShrink={0} flexDirection="column">
        <ChoiceMenu />
        <InputChrome width={columns} active={inputActive} nameHints={config.nameHints} />
        <FooterComp {...props} />
      </Box>
    </Box>
  );
}

/** Spec §21.2 default layout component. */
export const defaultLayout = DefaultLayout;
