import { Box, Text } from "ink";
import { useMemo } from "react";
import { useEvents } from "../hooks/use-events.ts";
import { useAppState } from "../context/app-state-context.tsx";
import { Overlay } from "./Overlay.tsx";
import { useTuiI18n } from "../i18n/context.tsx";

export function EventLog({ kindFilter }: { kindFilter?: string }) {
  const { t } = useTuiI18n();
  const { state } = useAppState();
  const kinds = state.filterEventKinds;
  const events = useEvents(kinds);

  const filtered = useMemo(() => {
    const ft = kindFilter?.trim();
    if (!ft) return events;
    return events.filter((e) => e.kind.includes(ft));
  }, [events, kindFilter]);

  return (
    <Overlay title={t("event_log.title")}>
      <Text dimColor>
        {t("event_log.showing", { count: filtered.length })}
        {kinds?.length ? t("event_log.kinds_prefix", { kinds: kinds.join(",") }) : ""}
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
