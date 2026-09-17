import { Box, Text } from "ink";
import { useEngineContext } from "../context/engine-context.tsx";
import { useAppState } from "../context/app-state-context.tsx";
import { Overlay } from "./Overlay.tsx";
import { useTuiI18n } from "../i18n/context.tsx";

export function ExplainView() {
  const { t } = useTuiI18n();
  const { engine, viewer } = useEngineContext();
  const { state } = useAppState();
  const turnId = state.lastExplainTurnId;
  if (!turnId) {
    return (
      <Overlay title={t("explain.title")}>
        <Text dimColor>{t("explain.empty")}</Text>
      </Overlay>
    );
  }
  const ex = engine.explain(turnId, viewer);
  return (
    <Overlay title={t("explain.title_turn", { turnId })} height={20}>
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
