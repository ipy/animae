import { Box, Text } from "ink";
import { Overlay } from "./Overlay.tsx";
import { useTuiI18n } from "../i18n/context.tsx";

export function HelpOverlay() {
  const { t } = useTuiI18n();
  return (
    <Overlay title={t("help.title")} width={70} height={18}>
      <Box flexDirection="column">
        <Text>{t("help.line_submit")}</Text>
        <Text>{t("help.line_choices")}</Text>
        <Text>{t("help.line_focus")}</Text>
        <Text>{t("help.line_overlays")}</Text>
        <Text>{t("help.line_save")}</Text>
        <Text>{t("help.line_esc")}</Text>
        <Box marginTop={1}>
          <Text dimColor>{t("help.commands_line")}</Text>
        </Box>
      </Box>
    </Overlay>
  );
}
