import {
  applyNarrationTurnChunk,
  applyTextTurnChunk,
  createParagraphStreamState,
  createUtteranceStreamState,
  type ParagraphStreamState,
  type TurnChunk,
} from "@animae/engine";

/** Horizontal rule printed around the text of a `scene_break` narration paragraph. */
const SCENE_BREAK_RULE = "──";
/** Prefix of a `normal` narration paragraph: no speaker name, set in from the dialogue. */
const NARRATION_INDENT = "  ";

export interface ChunkPrinterOptions {
  /** Line printed when the engine voids what was already streamed (`reset`); undefined prints nothing. */
  resetNotice?: (reason: "fallback" | "retry") => string;
  /** Prefix dialogue lines with the speaker (`name: `). Default true. */
  speakers?: boolean;
}

/**
 * Writes a turn's chunks to a plain-text stream: dialogue as `speaker: text`, narration as an indented line without a
 * name, a scene break as its text between rules, cues in brackets and choices as a numbered list.
 * Streamed fragments of one utterance or paragraph continue on the same line; a new utterance, paragraph, cue,
 * choice list, `reset` or `done` ends the line. A stream cannot be un-printed, so `reset` prints a notice instead.
 */
export class ChunkPrinter {
  private utterance = createUtteranceStreamState();
  private paragraph = createParagraphStreamState();
  /** A line has been started and not yet ended. */
  private lineOpen = false;
  /** Text of the open `scene_break` paragraph; it is printed whole when the paragraph ends. */
  private breakText = "";
  private readonly out: NodeJS.WritableStream;
  private readonly opts: ChunkPrinterOptions;
  private readonly speakers: boolean;

  constructor(out: NodeJS.WritableStream, opts: ChunkPrinterOptions = {}) {
    this.out = out;
    this.opts = opts;
    this.speakers = opts.speakers ?? true;
  }

  write(chunk: TurnChunk): void {
    switch (chunk.type) {
      case "text": {
        this.closeParagraph();
        const applied = applyTextTurnChunk(this.utterance, chunk);
        this.utterance = applied.state;
        if (applied.newUtterance) {
          this.endLine();
          if (this.speakers && chunk.speaker) this.out.write(`${chunk.speaker}: `);
        }
        this.out.write(applied.delta);
        this.lineOpen = true;
        return;
      }
      case "narration": {
        this.closeUtterance();
        const prior = this.paragraph;
        const applied = applyNarrationTurnChunk(prior, chunk);
        this.paragraph = applied.state;
        if (applied.newParagraph) {
          if (applied.completePrior) this.endParagraph(prior);
          this.breakText = "";
          if (applied.state.style === "normal") this.out.write(NARRATION_INDENT);
        }
        if (applied.state.style === "scene_break") {
          this.breakText += applied.delta;
        } else {
          this.out.write(applied.delta);
          this.lineOpen = true;
        }
        return;
      }
      case "cue": {
        this.closeAll();
        const name = typeof chunk.cue.args.name === "string" ? chunk.cue.args.name : JSON.stringify(chunk.cue.args);
        this.out.write(`[${chunk.cue.type}: ${name}]\n`);
        return;
      }
      case "choices": {
        this.closeAll();
        for (const [i, c] of chunk.choices.entries()) this.out.write(`  ${i + 1}. ${c.text}\n`);
        return;
      }
      case "reset": {
        this.closeAll();
        const notice = this.opts.resetNotice?.(chunk.reason);
        if (notice) this.out.write(`${notice}\n`);
        return;
      }
      case "done": {
        this.closeAll();
        return;
      }
      default:
        return;
    }
  }

  /** End a line left open (a stream that stopped without `done`). */
  finish(): void {
    this.closeAll();
  }

  private closeUtterance(): void {
    if (this.utterance.open) this.endLine();
    this.utterance = createUtteranceStreamState();
  }

  private closeParagraph(): void {
    this.endParagraph(this.paragraph);
    this.paragraph = createParagraphStreamState();
  }

  /** End a paragraph's output: a scene break prints its text between rules, other paragraphs end their line. */
  private endParagraph(p: ParagraphStreamState): void {
    if (!p.open) return;
    if (p.style === "scene_break") {
      const text = this.breakText.trim();
      this.out.write(text ? `${SCENE_BREAK_RULE} ${text} ${SCENE_BREAK_RULE}\n` : `${SCENE_BREAK_RULE}${SCENE_BREAK_RULE}\n`);
      this.breakText = "";
      return;
    }
    this.endLine();
  }

  private closeAll(): void {
    this.closeUtterance();
    this.closeParagraph();
    this.endLine();
  }

  private endLine(): void {
    if (!this.lineOpen) return;
    this.out.write("\n");
    this.lineOpen = false;
  }
}
