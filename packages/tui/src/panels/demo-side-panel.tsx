import { Box, Text } from "ink";
import type { Engine, Viewer } from "@animae/engine";

/** Minimal side panel for TUI dev/QA (engine-neutral demo data). */
export function DemoSidePanel({ engine }: { viewer: Viewer; engine: Engine }) {
  const time = engine.query("player", "world/time") as { day?: number; minute?: number } | undefined;
  const loc = engine.query("player", "world/location") as { name?: string } | undefined;
  return (
    <Box flexDirection="column">
      <Text>Demo session</Text>
      <Text>{loc?.name ? `Location: ${loc.name}` : "No location"}</Text>
      <Text>{time ? `Day ${time.day ?? "?"} ${time.minute ?? 0}m` : ""}</Text>
    </Box>
  );
}
