import type { TurnChunk } from "@animae/engine";
import type { HostChoiceState, HostSessionUiState, StreamCallbacks, StreamSegmentKind, TranscriptEntry } from "./types.ts";

let entrySeq = 0;

function kindFromChunk(chunk: TurnChunk, speaker?: string): StreamSegmentKind {
  if (chunk.type === "text") {
    if (!speaker || speaker === "player") return "dialogue";
    return "dialogue";
  }
  return "narration";
}

export async function consumeTurnStream(
  stream: AsyncIterable<TurnChunk>,
  ui: HostSessionUiState,
  opts: {
    requestId?: string;
    stream?: StreamCallbacks;
    onChoices?: (choices: HostChoiceState) => void;
    abortSignal?: AbortSignal;
  } = {},
): Promise<{ turnId?: string }> {
  let textBuffer = "";
  let speaker: string | undefined;
  let entryId: string | undefined;
  let streamKind: StreamSegmentKind = "dialogue";
  let turnId: string | undefined;
  const pushTranscript = (entry: TranscriptEntry) => {
    ui.transcript.push(entry);
    while (ui.transcript.length > ui.transcriptLimit) ui.transcript.shift();
    opts.stream?.onStateChange?.();
  };

  for await (const chunk of stream) {
    if (opts.abortSignal?.aborted) {
      ui.speaking = false;
      if (opts.requestId && opts.stream) {
        opts.stream.onStreamEnd?.(opts.requestId, turnId);
      }
      break;
    }
    switch (chunk.type) {
      case "text": {
        if (entryId) {
          const idx = ui.transcript.findIndex((e) => e.id === entryId);
          if (idx >= 0) ui.transcript[idx] = { ...ui.transcript[idx]!, complete: true };
        }
        textBuffer = chunk.text;
        speaker = chunk.speaker;
        streamKind = kindFromChunk(chunk, speaker);
        entryId = `dlg_${++entrySeq}`;
        ui.speaking = true;
        const entryKind =
          streamKind === "event" ? "narration" : streamKind === "dialogue" ? "dialogue" : "narration";
        pushTranscript({
          id: entryId,
          kind: entryKind,
          speaker,
          text: textBuffer,
          complete: false,
        });
        if (opts.requestId && opts.stream) {
          opts.stream.onStreamStart?.(opts.requestId, streamKind, speaker);
          opts.stream.onStreamDelta?.(opts.requestId, textBuffer);
        }
        break;
      }
      case "cue": {
        if (entryId && chunk.cue.type === "action") {
          const idx = ui.transcript.findIndex((e) => e.id === entryId);
          const line = String(chunk.cue.args["text"] ?? "");
          if (idx >= 0) {
            ui.transcript[idx] = {
              ...ui.transcript[idx]!,
              kind: "action",
              text: line || ui.transcript[idx]!.text,
            };
          }
        }
        break;
      }
      case "choices": {
        const choices: HostChoiceState = {
          choices: chunk.choices.map((c) => ({ id: c.id, text: c.text })),
          selected: 0,
        };
        ui.choices = choices;
        opts.onChoices?.(choices);
        opts.stream?.onStateChange?.();
        break;
      }
      case "done": {
        turnId = chunk.turnId;
        if (entryId) {
          const idx = ui.transcript.findIndex((e) => e.id === entryId);
          if (idx >= 0) {
            ui.transcript[idx] = {
              ...ui.transcript[idx]!,
              complete: true,
              turnId: chunk.turnId,
            };
          }
        }
        ui.speaking = false;
        if (opts.requestId && opts.stream) {
          opts.stream.onStreamEnd?.(opts.requestId, chunk.turnId);
        }
        entryId = undefined;
        textBuffer = "";
        opts.stream?.onStateChange?.();
        break;
      }
      default:
        break;
    }
  }
  ui.speaking = false;
  return { turnId };
}
