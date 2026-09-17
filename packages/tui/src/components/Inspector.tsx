import { Box, Text } from "ink";
import { useEngineContext } from "../context/engine-context.tsx";
import { useQuery } from "../hooks/use-query.ts";
import { Overlay } from "./Overlay.tsx";
import { JsonTree } from "../utils/json-tree.tsx";
import { useTuiI18n } from "../i18n/context.tsx";

export function Inspector() {
  const { t } = useTuiI18n();
  const { viewer } = useEngineContext();
  const scene = useQuery("scene");
  const beat = useQuery("director/beat");
  const anchors = useQuery("director/anchors");

  return (
    <Overlay title={t("inspector.title")} width={78} height={22}>
      <Text dimColor>{t("inspector.meta", { viewer })}</Text>
      <Box marginTop={1} flexDirection="column">
        <Text bold>scene</Text>
        <JsonTree value={scene} maxDepth={3} />
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text bold>director/beat</Text>
        <JsonTree value={beat} maxDepth={2} />
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text bold>director/anchors</Text>
        <JsonTree value={anchors} maxDepth={2} />
      </Box>
      <Box marginTop={1}>
        <Text dimColor>{t("inspector.query_hint")}</Text>
      </Box>
    </Overlay>
  );
}
