import { Box, Text } from "ink";
import { useEffect, useState } from "react";
import type { SaveSlot } from "@animae/engine";
import { useEngineContext } from "../context/engine-context.tsx";
import { Overlay } from "./Overlay.tsx";

export function LoadSlots({ selected }: { selected: number }) {
  const { engine } = useEngineContext();
  const [saves, setSaves] = useState<SaveSlot[]>([]);

  useEffect(() => {
    void engine.timeline.saves().then(setSaves);
  }, [engine]);

  return (
    <Overlay title="Load save (↑/↓ · Enter)" width={64}>
      <Box flexDirection="column">
        {saves.length === 0 ? (
          <Text dimColor>No saves yet — use Ctrl+S or :save</Text>
        ) : (
          saves.map((s, i) => (
            <Text key={`${s.label}-${s.eventId}`} color={i === selected ? "green" : undefined}>
              {i === selected ? "▸ " : "  "}
              {s.label} · {s.branch} @ {s.eventId}
            </Text>
          ))
        )}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Enter loads slot · Esc closes</Text>
      </Box>
    </Overlay>
  );
}
