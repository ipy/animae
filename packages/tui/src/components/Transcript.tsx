import { Box, Text, useStdout } from "ink";
import { Clickable } from "./Clickable.tsx";
import { Button } from "./Button.tsx";
import { useEffect, useMemo, useState } from "react";
import { useAppState } from "../context/app-state-context.tsx";
import { Typewriter } from "./Typewriter.tsx";
import { useTheme } from "../hooks/use-theme.ts";
import { useSpeakerColor } from "../hooks/use-speaker-color.ts";
import { useSpeakerLabel } from "../hooks/use-speaker-label.ts";
import { wrapToWidth } from "../utils/display-width.ts";
import { transcriptEntryWindow } from "../utils/transcript-limits.ts";
import { expressionLabel } from "../cues/builtins.tsx";
import { cueVisibleAt } from "../cues/registry.ts";

function DialogueBlock({
  entry,
  isActive,
  wrapCols,
  activeVisible,
  onProgress,
  onComplete,
  skipSignal,
}: {
  entry: { id: string; speaker?: string; text: string; cues?: import("../types.ts").TranscriptCue[] };
  isActive: boolean;
  wrapCols: number;
  activeVisible: number;
  onProgress: (v: number) => void;
  onComplete: () => void;
  skipSignal: number;
}) {
  const theme = useTheme();
  const speakerColor = useSpeakerColor(entry.speaker);
  const speakerLabel = useSpeakerLabel(entry.speaker);
  const expr =
    entry.cues && entry.cues.length > 0
      ? expressionLabel(entry.cues, isActive ? activeVisible : 9999)
      : undefined;

  return (
    <Box flexDirection="column">
      {entry.speaker ? (
        <Text>
          <Text bold color={speakerColor}>
            {speakerLabel ?? entry.speaker}
          </Text>
          {expr ? <Text dimColor> [{expr}]</Text> : null}
          <Text>：</Text>
        </Text>
      ) : null}
      {isActive ? (
        <Typewriter
          text={entry.text}
          active
          wrapCols={wrapCols}
          skipSignal={skipSignal}
          color={theme.colors.narration}
          onProgress={(v) => onProgress(v)}
          onComplete={onComplete}
        />
      ) : (
        wrapToWidth(entry.text, wrapCols).map((line, li) => (
          <Text key={li} color={theme.colors.narration}>
            {line}
          </Text>
        ))
      )}
    </Box>
  );
}

export function Transcript({ width, rows }: { width: number; rows?: number }) {
  const theme = useTheme();
  const { state, dispatch, config } = useAppState();
  const { stdout } = useStdout();
  const [activeVisible, setActiveVisible] = useState(0);
  const wrapCols = Math.max(20, width - 4);

  const entries = state.transcript;
  const lastIncomplete = useMemo(() => {
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i]!;
      if (!e.complete && (e.kind === "dialogue" || e.kind === "action")) return e;
    }
    return undefined;
  }, [entries]);

  const typewriterActive = Boolean(lastIncomplete);
  useEffect(() => {
    dispatch({ type: "setTypewriterActive", active: typewriterActive });
  }, [typewriterActive, dispatch]);

  useEffect(() => {
    if (!lastIncomplete?.cues || !theme.bell) return;
    for (const c of lastIncomplete.cues) {
      if (c.type !== "sfx") continue;
      if (cueVisibleAt(c.at, activeVisible)) {
        stdout.write("\u0007");
        break;
      }
    }
  }, [activeVisible, lastIncomplete, theme.bell, stdout]);

  const scroll = state.transcriptScroll;
  const scrolledUp = scroll > 0;
  const entryWindow = transcriptEntryWindow(rows ?? 24);
  const visibleEntries = entries.slice(
    Math.max(0, entries.length - entryWindow - scroll),
    entries.length - scroll,
  );

  return (
    <Clickable
      hint="Transcript scroll"
      onWheel={(ev) => {
        const delta = ev.button === "wheelUp" ? 4 : ev.button === "wheelDown" ? -4 : 0;
        if (delta) dispatch({ type: "scrollTranscript", delta });
      }}
    >
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {scrolledUp ? (
          <Button
            label="跳到最新"
            hint="Follow transcript tail"
            onPress={() => dispatch({ type: "scrollTranscriptTail" })}
          />
        ) : null}
        {visibleEntries.map((entry) => {
        const isActive = entry.id === lastIncomplete?.id;
        const lines = wrapToWidth(entry.text, wrapCols);

        if (entry.kind === "system") {
          return (
            <Text key={entry.id} dimColor>
              {entry.text}
            </Text>
          );
        }

        if (entry.kind === "action") {
          const cue = entry.cues?.find((c) => c.type === "action");
          const renderer = cue ? config.cueRegistry.get("action") : undefined;
          if (renderer && cue) {
            const node = renderer(
              { type: "action", args: cue.args, at: cue.at },
              {
                theme,
                visibleChars: isActive ? activeVisible : 9999,
                totalChars: entry.text.length,
              },
            );
            if (node) return <Box key={entry.id}>{node}</Box>;
          }
          return (
            <Text key={entry.id} italic dimColor>
              （{entry.text}）
            </Text>
          );
        }

        return (
          <Box key={entry.id} flexDirection="column">
            <DialogueBlock
              entry={entry}
              isActive={isActive}
              wrapCols={wrapCols}
              activeVisible={activeVisible}
              skipSignal={state.typewriterSkip}
              onProgress={(v) => setActiveVisible(v)}
              onComplete={() =>
                dispatch({ type: "patchTranscript", id: entry.id, patch: { complete: true } })
              }
            />
            {entry.cues
              ?.filter((c) => c.type === "sfx")
              .map((c, i) => {
                const renderer = config.cueRegistry.get("sfx");
                if (!renderer) return null;
                const node = renderer(
                  { type: "sfx", args: c.args, at: c.at },
                  {
                    theme,
                    visibleChars: isActive ? activeVisible : 9999,
                    totalChars: entry.text.length,
                  },
                );
                return node ? <Box key={`${entry.id}-sfx-${i}`}>{node}</Box> : null;
              })}
          </Box>
        );
        })}
      </Box>
    </Clickable>
  );
}
