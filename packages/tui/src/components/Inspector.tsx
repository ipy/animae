import { Box, Text } from "ink";
import { useEngineContext } from "../context/engine-context.tsx";
import { useQuery } from "../hooks/use-query.ts";
import { Overlay } from "./Overlay.tsx";
import { JsonTree } from "../utils/json-tree.tsx";

export function Inspector() {
  const { viewer } = useEngineContext();
  const scene = useQuery("scene");
  const beat = useQuery("director/beat");
  const anchors = useQuery("director/anchors");

  return (
    <Overlay title="Inspector (F5)" width={78} height={22}>
      <Text dimColor>viewer={viewer} · paths: scene, director/beat, director/anchors</Text>
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
        <Text dimColor>Use :query &lt;viewer&gt; &lt;path&gt; for arbitrary paths</Text>
      </Box>
    </Overlay>
  );
}
