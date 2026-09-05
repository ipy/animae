import { Box, Text } from "ink";
import { Overlay } from "./Overlay.tsx";

export function HelpOverlay() {
  return (
    <Overlay title="Help (F1)" width={70} height={18}>
      <Box flexDirection="column">
        <Text>Enter — submit input · ↑/↓ — choice / history</Text>
        <Text>1–9 — pick choice · any key — skip typewriter</Text>
        <Text>Tab — focus transcript / side panel · PgUp/PgDn — scroll</Text>
        <Text>F1 help · F2 event log · F3 timeline · F4 explain · F5 inspector</Text>
        <Text>Ctrl+S save · Ctrl+L load · Ctrl+Z rewind turn · Ctrl+C quit</Text>
        <Text>Esc — close overlay</Text>
        <Box marginTop={1}>
          <Text dimColor>
            Commands: :save :load :rewind :branches :explain :query :advance :help :quit
          </Text>
        </Box>
      </Box>
    </Overlay>
  );
}
