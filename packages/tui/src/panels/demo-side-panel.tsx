import { Box, Text } from "ink";
import type { Engine, Viewer } from "@animae/engine";
import { useTuiI18n } from "../i18n/context.tsx";

/** Minimal side panel for TUI dev/QA (engine-neutral demo data). */
export function DemoSidePanel({ engine }: { viewer: Viewer; engine: Engine }) {
  const { t } = useTuiI18n();
  const time = engine.query("player", "world/time") as { day?: number; minute?: number } | undefined;
  const loc = engine.query("player", "world/location");
  const place = typeof loc === "string" && loc ? loc : undefined;
  return (
    <Box flexDirection="column">
      <Text>{t("demo_panel.session")}</Text>
      <Text>{place ? t("demo_panel.location", { name: place }) : t("demo_panel.no_location")}</Text>
      <Text>
        {time
          ? t("demo_panel.day_minute", { day: time.day ?? "?", minute: time.minute ?? 0 })
          : ""}
      </Text>
    </Box>
  );
}
