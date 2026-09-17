import { Box, Text, useBoxMetrics, type DOMElement } from "ink";
import { useEffect, useRef } from "react";
import { Stack } from "./Viewport.tsx";
import { useQuery } from "../hooks/use-query.ts";
import { useTheme } from "../hooks/use-theme.ts";
import { useAppState } from "../context/app-state-context.tsx";
import { useEngineContext } from "../context/engine-context.tsx";
import { FieldList } from "./FieldList.tsx";
import { ParticipantTracks } from "./ParticipantTracks.tsx";
import { Clickable } from "./Clickable.tsx";
import { useTuiI18n } from "../i18n/context.tsx";
import { resolveText } from "../utils/resolve-text.ts";
import { useMouseTarget } from "../context/mouse-context.tsx";

export function SidePanel({ width, fill = false }: { width: number; fill?: boolean }) {
  const { t } = useTuiI18n();
  const theme = useTheme();
  const { config, state, dispatch } = useAppState();
  const { engine, viewer } = useEngineContext();
  const scene = useQuery("scene") as {
    location?: string;
    participants?: string[];
  } | null;
  const beat = useQuery("director/beat") as { id?: string; label?: string } | null;
  const anchors = useQuery("director/anchors") as Array<{ id?: string; label?: string }> | null;
  const fields = useQuery("world/fields") as unknown;
  const show = theme.sidePanel.show;

  const sections = [...config.panels].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  // The generic sections only take room while they have something to say; a host with its own panels
  // would otherwise start every screen with four empty headings.
  const participants = scene?.participants ?? [];
  const showParticipants = show.includes("participants") && participants.length > 0;
  const showTracks = show.includes("tracks") && participants.some((p) => p !== "player");
  const showFields = show.includes("fields") && Array.isArray(fields) && fields.length > 0;
  const showAnchor = show.includes("anchor") && (Boolean(beat?.label) || (anchors?.length ?? 0) > 0);
  const showTitle = showParticipants || showTracks || showFields || showAnchor || sections.length === 0;

  // The panel is taller than its region more often than not: `sidePanelScroll` rows are hidden above, the
  // rest below, and a line at the bottom says so. Both heights come from the laid-out frame.
  const viewportRef = useRef<DOMElement>(null);
  const contentRef = useRef<DOMElement>(null);
  const viewport = useBoxMetrics(viewportRef);
  const content = useBoxMetrics(contentRef);
  const measured = viewport.hasMeasured && content.hasMeasured;
  const maxOffset = measured ? Math.max(0, content.height - viewport.height) : 0;
  const offset = Math.min(state.sidePanelScroll, maxOffset);
  const hiddenBelow = Math.max(0, maxOffset - offset);
  // Rows used up by the indicator itself are not available to the content.
  const indicator = offset > 0 || hiddenBelow > 0;

  useMouseTarget("side-panel-scroll", viewportRef, {
    wheel: true,
    onEvent: (ev) => {
      if (ev.button === "wheelUp") dispatch({ type: "scrollSide", delta: -3 });
      else if (ev.button === "wheelDown") dispatch({ type: "scrollSide", delta: 3 });
    },
  });

  useEffect(() => {
    if (measured && state.sidePanelScroll > maxOffset) {
      dispatch({ type: "scrollSide", delta: maxOffset - state.sidePanelScroll });
    }
  }, [measured, maxOffset, state.sidePanelScroll, dispatch]);

  return (
    <Box flexDirection="column" width={width} paddingX={1} overflow="hidden" flexGrow={fill ? 1 : 0}>
      <Box ref={viewportRef} flexDirection="column" flexGrow={1} flexShrink={1} flexBasis={0} overflow="hidden">
        <Box ref={contentRef} flexDirection="column" flexShrink={0} marginTop={-offset}>
          <Stack>
            {showTitle ? (
              <Text bold color={theme.colors.primary}>
                {t("side_panel.title")}
              </Text>
            ) : null}
            {showParticipants ? (
              <Box flexDirection="column" marginTop={1}>
                <Text dimColor>{t("side_panel.participants")}</Text>
                {participants.map((p) => (
                  <Text key={p}>· {p}</Text>
                ))}
              </Box>
            ) : null}
            {showTracks ? (
              <Box flexDirection="column" marginTop={1}>
                <Text dimColor>{t("side_panel.tracks")}</Text>
                <ParticipantTracks />
              </Box>
            ) : null}
            {showFields ? (
              <Box flexDirection="column" marginTop={1}>
                <Text dimColor>{t("side_panel.fields")}</Text>
                <FieldList />
              </Box>
            ) : null}
            {showAnchor ? (
              <Box flexDirection="column" marginTop={1}>
                <Text dimColor>{t("side_panel.beat_anchors")}</Text>
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
              const sectionTitle = resolveText(s.title);
              return (
                <Box key={s.id} flexDirection="column" marginTop={1}>
                  <Clickable
                    hint={t("side_panel.toggle_hint", { title: sectionTitle })}
                    onPress={() => dispatch({ type: "togglePanelCollapsed", panelId: s.id })}
                  >
                    <Text dimColor>
                      {collapsed ? "▸ " : "▾ "}
                      {sectionTitle}
                    </Text>
                  </Clickable>
                  {!collapsed ? <s.render viewer={viewer} engine={engine} /> : null}
                </Box>
              );
            })}
          </Stack>
        </Box>
      </Box>
      {indicator ? (
        <Box flexShrink={0}>
          <Text dimColor>{t("side_panel.scroll_more", { above: offset, below: hiddenBelow })}</Text>
        </Box>
      ) : null}
    </Box>
  );
}
