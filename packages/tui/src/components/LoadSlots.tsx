import { Box, Text } from "ink";
import { useEffect, useState } from "react";
import type { SaveSlot } from "@animae/engine";
import { useEngineContext } from "../context/engine-context.tsx";
import { Overlay } from "./Overlay.tsx";
import { useTuiI18n } from "../i18n/context.tsx";

export function LoadSlots({ selected }: { selected: number }) {
  const { t } = useTuiI18n();
  const { engine } = useEngineContext();
  const [saves, setSaves] = useState<SaveSlot[]>([]);

  useEffect(() => {
    void engine.timeline.saves().then(setSaves);
  }, [engine]);

  return (
    <Overlay title={t("load_slots.title")} width={64}>
      <Box flexDirection="column">
        {saves.length === 0 ? (
          <Text dimColor>{t("load_slots.empty")}</Text>
        ) : (
          saves.map((s, i) => (
            <Text key={`${s.label}-${s.eventId}`} color={i === selected ? "green" : undefined}>
              {i === selected ? "▸ " : "  "}
              {t("load_slots.row", { label: s.label, branch: s.branch, eventId: s.eventId })}
            </Text>
          ))
        )}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>{t("load_slots.footer")}</Text>
      </Box>
    </Overlay>
  );
}
