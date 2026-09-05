import { Box, Text } from "ink";
import { useEngineContext } from "../context/engine-context.tsx";
import { useAppState } from "../context/app-state-context.tsx";
import { Overlay } from "./Overlay.tsx";

export function ExplainView() {
  const { engine, viewer } = useEngineContext();
  const { state } = useAppState();
  const turnId = state.lastExplainTurnId;
  if (!turnId) {
    return (
      <Overlay title="Explain (F4)">
        <Text dimColor>No turn to explain yet.</Text>
      </Overlay>
    );
  }
  const ex = engine.explain(turnId, viewer);
  return (
    <Overlay title={`Explain ${turnId}`} height={20}>
      <Box flexDirection="column">
        {ex.chain.map((step) => (
          <Text key={step.eventId}>
            <Text dimColor>{step.kind} </Text>
            {step.summary}
          </Text>
        ))}
      </Box>
    </Overlay>
  );
}
