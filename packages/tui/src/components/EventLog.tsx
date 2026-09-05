import { Box, Text } from "ink";
import { useMemo } from "react";
import { useEvents } from "../hooks/use-events.ts";
import { useAppState } from "../context/app-state-context.tsx";
import { Overlay } from "./Overlay.tsx";

export function EventLog({ kindFilter }: { kindFilter?: string }) {
  const { state } = useAppState();
  const kinds = state.filterEventKinds;
  const events = useEvents(kinds);

  const filtered = useMemo(() => {
    const ft = kindFilter?.trim();
    if (!ft) return events;
    return events.filter((e) => e.kind.includes(ft));
  }, [events, kindFilter]);

  return (
    <Overlay title="Event log (F2)">
      <Text dimColor>
        Showing {filtered.length} events{kinds?.length ? ` · kinds: ${kinds.join(",")}` : ""}
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {filtered.slice(-20).map((e) => (
          <Text key={e.id}>
            <Text dimColor>{e.id} </Text>
            {e.kind}
          </Text>
        ))}
      </Box>
    </Overlay>
  );
}
