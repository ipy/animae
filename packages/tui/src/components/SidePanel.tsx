import { Box, Text } from "ink";
import { useQuery } from "../hooks/use-query.ts";
import { useTheme } from "../hooks/use-theme.ts";
import { useAppState } from "../context/app-state-context.tsx";
import { useEngineContext } from "../context/engine-context.tsx";
import { FieldList } from "./FieldList.tsx";
import { ParticipantTracks } from "./ParticipantTracks.tsx";
import { Clickable } from "./Clickable.tsx";

export function SidePanel({ width }: { width: number }) {
  const theme = useTheme();
  const { config, state, dispatch } = useAppState();
  const { engine, viewer } = useEngineContext();
  const scene = useQuery("scene") as {
    location?: string;
    participants?: string[];
  } | null;
  const beat = useQuery("director/beat") as { id?: string; label?: string } | null;
  const anchors = useQuery("director/anchors") as Array<{ id?: string; label?: string }> | null;
  const show = theme.sidePanel.show;

  const sections = [...config.panels].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  return (
    <Box flexDirection="column" width={width} paddingX={1}>
      <Text bold color={theme.colors.primary}>
        Side panel
      </Text>
      {show.includes("participants") && scene?.participants ? (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>Participants</Text>
          {scene.participants.map((p) => (
            <Text key={p}>· {p}</Text>
          ))}
        </Box>
      ) : null}
      {show.includes("tracks") ? (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>Tracks</Text>
          <ParticipantTracks />
        </Box>
      ) : null}
      {show.includes("fields") ? (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>Fields</Text>
          <FieldList />
        </Box>
      ) : null}
      {show.includes("anchor") ? (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>Beat / anchors</Text>
          {beat?.label ? <Text>{beat.label}</Text> : null}
          {anchors?.slice(0, 5).map((a, i) => (
            <Text key={a.id ?? i} dimColor>
              ◦ {a.label ?? a.id}
            </Text>
          ))}
        </Box>
      ) : null}
      {sections.map((s) => {
        const collapsed = state.collapsedPanels[s.id] === true;
        return (
          <Box key={s.id} flexDirection="column" marginTop={1}>
            <Clickable
              hint={`Toggle ${s.title}`}
              onPress={() => dispatch({ type: "togglePanelCollapsed", panelId: s.id })}
            >
              <Text dimColor>
                {collapsed ? "▸ " : "▾ "}
                {s.title}
              </Text>
            </Clickable>
            {!collapsed ? <s.render viewer={viewer} engine={engine} /> : null}
          </Box>
        );
      })}
      {state.sidePanelScroll > 0 ? (
        <Text dimColor>scroll +{state.sidePanelScroll}</Text>
      ) : null}
    </Box>
  );
}
