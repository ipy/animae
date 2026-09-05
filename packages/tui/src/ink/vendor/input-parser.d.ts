export type InputParserEvent = string | { paste: string };

export type InputParser = {
  push(chunk: string): InputParserEvent[];
  hasPendingEscape(): boolean;
  flushPendingEscape(): string | undefined;
  reset(): void;
};

export function isCompleteControlSequence(input: string): boolean;

export function createInputParser(): InputParser;
