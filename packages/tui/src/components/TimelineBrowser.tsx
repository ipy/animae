import { Box, Text } from "ink";
import { useEffect, useState } from "react";
import { useEngineContext } from "../context/engine-context.tsx";
import { useQuery } from "../hooks/use-query.ts";
import { useAppState } from "../context/app-state-context.tsx";
import { Overlay } from "./Overlay.tsx";

export function TimelineBrowser({ selectedBranch }: { selectedBranch: number }) {
  const { engine } = useEngineContext();
  const { state } = useAppState();
  const timeline = useQuery("timeline") as {
    branch?: string;
    saves?: Array<{ label: string; branch: string; eventId: string }>;
  } | null;
  const [branches, setBranches] = useState<Array<{ name: string }>>([]);
  const [saves, setSaves] = useState<Array<{ label: string; branch: string; eventId: string }>>(
    [],
  );

  useEffect(() => {
    void engine.timeline.branches().then(setBranches);
    void engine.timeline.saves().then(setSaves);
  }, [engine]);

  const branchNames = branches.map((b) => b.name);
  const confirmRewind = state.pendingRewindEventId;

  return (
    <Overlay title="Timeline (F3)" width={76} height={22}>
      <Text>
        Current branch: <Text color="cyan">{timeline?.branch ?? engine.info().branch}</Text>
      </Text>
      <Box flexDirection="column" marginTop={1}>
        <Text bold>Branches (↑/↓ · Enter switch)</Text>
        {branchNames.map((name, i) => (
          <Text key={name} color={i === selectedBranch ? "green" : undefined}>
            {i === selectedBranch ? "▸ " : "  "}
            {name}
          </Text>
        ))}
      </Box>
      <Box flexDirection="column" marginTop={1}>
        <Text bold>Saves (Ctrl+L from game)</Text>
        {(saves.length ? saves : timeline?.saves ?? []).slice(0, 8).map((s) => (
          <Text key={`${s.label}-${s.eventId}`} dimColor>
            {s.label} @ {s.eventId} ({s.branch})
          </Text>
        ))}
      </Box>
      {confirmRewind ? (
        <Box marginTop={1}>
          <Text color="yellow">
            Pending rewind to {confirmRewind} — confirm from main key handler (Enter)
          </Text>
        </Box>
      ) : null}
    </Overlay>
  );
}
