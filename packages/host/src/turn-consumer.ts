import {
  applyNarrationTurnChunk,
  applyTextTurnChunk,
  closeParagraphStream,
  createParagraphStreamState,
  createUtteranceStreamState,
  isActorEcho,
  type ParagraphStreamState,
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
    /**
     * The acting character of the turn. Its echoed line is not part of what a `reset` chunk discards; defaults to
     * `suppressStreamSpeaker`.
     */
    actor?: string;
  } = {},
): Promise<{ turnId?: string }> {
  const actor = opts.actor ?? opts.suppressStreamSpeaker;
  let utterance = createUtteranceStreamState();
  let paragraph: ParagraphStreamState = createParagraphStreamState();
  let streamKind: StreamSegmentKind = "dialogue";
  let turnId: string | undefined;
  /** Transcript rows made from the characters' and the narrator's output since the player's echo of the sub-turn in flight. */
  let outputEntries: string[] = [];
  let choicesOffered = false;
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
      opts.stream.onStreamEnd?.(opts.requestId, turnId, "dialogue");
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

  /** A paragraph ends when another paragraph, a `text`, a `cue`, `choices` or `done` follows. */
  const completeOpenParagraph = (turn?: string) => {
    if (!paragraph.open) {
      paragraph = closeParagraphStream(paragraph);
      return;
    }
    if (opts.requestId && opts.stream && paragraph.streamStarted) {
      opts.stream.onStreamEnd?.(opts.requestId, turn ?? turnId, "narration");
    }
    if (paragraph.entryId) patchTranscript(paragraph.entryId, { complete: true, ...(turn ? { turnId: turn } : {}) });
    paragraph = closeParagraphStream(paragraph);
  };

  /**
   * The output since the player's echo is void: remove its rows and tell clients to drop what they streamed. A reset
   * ends every open stream segment of the request, so no `end` is sent for them.
   */
  const discardOutput = (reason: Extract<TurnChunk, { type: "reset" }>["reason"]) => {
    if (opts.requestId && opts.stream) opts.stream.onStreamReset?.(opts.requestId, reason);
    utterance = createUtteranceStreamState();
    paragraph = closeParagraphStream(paragraph);
    if (outputEntries.length > 0) {
      const gone = new Set(outputEntries);
      for (let i = ui.transcript.length - 1; i >= 0; i--) {
        if (gone.has(ui.transcript[i]!.id)) ui.transcript.splice(i, 1);
      }
    }
    outputEntries = [];
    if (choicesOffered) {
      ui.choices = undefined;
      choicesOffered = false;
    }
    opts.stream?.onStateChange?.();
  };

  try {
    for await (const chunk of stream) {
    if (opts.abortSignal?.aborted) {
      ui.speaking = false;
      endStreamIfStarted();
      completeOpenUtterance();
      completeOpenParagraph();
      break;
    }
    switch (chunk.type) {
      case "text": {
        completeOpenParagraph();
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
          if (!isActorEcho(chunk, actor)) outputEntries.push(entryId);
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
          opts.stream.onStreamDelta?.(opts.requestId, applied.delta, "dialogue");
        }
        break;
      }
      case "narration": {
        if (utterance.open) {
          endStreamIfStarted();
          completeOpenUtterance();
        }
        const applied = applyNarrationTurnChunk(paragraph, chunk);
        if (applied.completePrior) completeOpenParagraph();
        paragraph = applied.state;

        if (applied.newParagraph) {
          const entryId = `nar_${++entrySeq}`;
          paragraph = { ...paragraph, entryId, streamStarted: false };
          outputEntries.push(entryId);
          pushTranscript({
            id: entryId,
            kind: "narration",
            text: applied.delta,
            style: paragraph.style,
            complete: false,
          });
        } else if (paragraph.entryId) {
          patchTranscript(paragraph.entryId, { text: paragraph.text });
        }

        if (opts.requestId && opts.stream) {
          if (!paragraph.streamStarted) {
            paragraph = { ...paragraph, streamStarted: true };
            opts.stream.onStreamStart?.(opts.requestId, "narration", undefined, paragraph.style);
          }
          opts.stream.onStreamDelta?.(opts.requestId, applied.delta, "narration");
        }
        break;
      }
      case "cue": {
        completeOpenParagraph();
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
        completeOpenParagraph();
        const choices: HostChoiceState = {
          choices: chunk.choices.map((c) => ({ id: c.id, text: c.text })),
          selected: 0,
        };
        ui.choices = choices;
        choicesOffered = true;
        opts.onChoices?.(choices);
        opts.stream?.onStateChange?.();
        break;
      }
      case "reset": {
        discardOutput(chunk.reason);
        break;
      }
      case "done": {
        turnId = chunk.turnId;
        endStreamIfStarted();
        completeOpenUtterance(chunk.turnId);
        completeOpenParagraph(chunk.turnId);
        outputEntries = [];
        choicesOffered = false;
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
    completeOpenParagraph();
    opts.stream?.onStateChange?.();
  }
  return { turnId };
}

function speakerSuppress(suppress?: string, speaker?: string): boolean {
  return Boolean(suppress && speaker && suppress === speaker);
}
