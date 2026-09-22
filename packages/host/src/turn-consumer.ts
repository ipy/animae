import {
  applyTextTurnChunk,
  createUtteranceStreamState,
  type TurnChunk,
} from "@animae/engine";
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
    /** Skip WS stream callbacks for this speaker (e.g. player lines echoed into transcript). */
    suppressStreamSpeaker?: string;
  } = {},
): Promise<{ turnId?: string }> {
  let utterance = createUtteranceStreamState();
  let streamKind: StreamSegmentKind = "dialogue";
  let turnId: string | undefined;
  const pushTranscript = (entry: TranscriptEntry) => {
    ui.transcript.push(entry);
    while (ui.transcript.length > ui.transcriptLimit) ui.transcript.shift();
    opts.stream?.onStateChange?.();
  };

  const patchTranscript = (id: string, patch: Partial<TranscriptEntry>) => {
    const idx = ui.transcript.findIndex((e) => e.id === id);
    if (idx >= 0) {
      ui.transcript[idx] = { ...ui.transcript[idx]!, ...patch };
      opts.stream?.onStateChange?.();
    }
  };

  const endStreamIfStarted = () => {
    if (opts.requestId && opts.stream && utterance.streamStarted) {
      opts.stream.onStreamEnd?.(opts.requestId, turnId);
    }
    utterance = { ...utterance, streamStarted: false };
  };

  const completeOpenUtterance = (turn?: string) => {
    if (!utterance.open || !utterance.entryId) {
      utterance = createUtteranceStreamState();
      return;
    }
    patchTranscript(utterance.entryId, { complete: true, ...(turn ? { turnId: turn } : {}) });
    utterance = createUtteranceStreamState();
  };

  try {
    for await (const chunk of stream) {
    if (opts.abortSignal?.aborted) {
      ui.speaking = false;
      endStreamIfStarted();
      completeOpenUtterance();
      break;
    }
    switch (chunk.type) {
      case "text": {
        const applied = applyTextTurnChunk(utterance, chunk);
        if (applied.completePrior) {
          endStreamIfStarted();
          completeOpenUtterance();
        }
        utterance = applied.state;

        if (applied.newUtterance) {
          const speaker = utterance.speaker;
          streamKind = kindFromChunk(chunk, speaker);
          const entryKind =
            streamKind === "event" ? "narration" : streamKind === "dialogue" ? "dialogue" : "narration";
          const entryId = `dlg_${++entrySeq}`;
          utterance = { ...utterance, entryId, streamStarted: false };
          ui.speaking = true;
          pushTranscript({
            id: entryId,
            kind: entryKind,
            speaker,
            text: applied.delta,
            complete: false,
          });
        } else if (utterance.entryId) {
          patchTranscript(utterance.entryId, { text: utterance.text });
        }

        const suppressStream = speakerSuppress(opts.suppressStreamSpeaker, utterance.speaker);
        if (opts.requestId && opts.stream && !suppressStream) {
          if (!utterance.streamStarted) {
            utterance = { ...utterance, streamStarted: true };
            opts.stream.onStreamStart?.(opts.requestId, streamKind, utterance.speaker);
          }
          opts.stream.onStreamDelta?.(opts.requestId, applied.delta);
        }
        break;
      }
      case "cue": {
        if (utterance.entryId && chunk.cue.type === "action") {
          const line = String(chunk.cue.args["text"] ?? "");
          patchTranscript(utterance.entryId, {
            kind: "action",
            text: line || utterance.text,
          });
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
        endStreamIfStarted();
        completeOpenUtterance(chunk.turnId);
        ui.speaking = false;
        opts.stream?.onStateChange?.();
        break;
      }
      default:
        break;
    }
    }
  } finally {
    ui.speaking = false;
    endStreamIfStarted();
    completeOpenUtterance();
    opts.stream?.onStateChange?.();
  }
  return { turnId };
}

function speakerSuppress(suppress?: string, speaker?: string): boolean {
  return Boolean(suppress && speaker && suppress === speaker);
}
