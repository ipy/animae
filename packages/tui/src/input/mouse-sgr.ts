/** xterm SGR (1006) mouse reporting — press, release, motion, wheel. */

export type MouseButton = "left" | "middle" | "right" | "wheelUp" | "wheelDown" | "unknown";

export type MouseEventKind = "press" | "release" | "motion";

export interface SgrMouseEvent {
  kind: MouseEventKind;
  button: MouseButton;
  col: number;
  row: number;
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
  rawButton: number;
}

export interface MouseParseResult {
  events: SgrMouseEvent[];
  /** Bytes to pass through to the keyboard parser. */
  rest: string;
  /** Incomplete trailing escape — hold for next chunk. */
  pending: string;
}

const ESC = "\u001b";

function decodeButton(code: number): { kind: MouseEventKind; button: MouseButton } {
  const release = (code & 64) !== 0 && code < 128;
  const isWheel = code >= 64 && code <= 65;
  if (isWheel) {
    return {
      kind: "press",
      button: code === 64 ? "wheelUp" : "wheelDown",
    };
  }
  const motion = (code & 32) !== 0;
  const btn = code & ~96;
  let button: MouseButton = "unknown";
  if (btn === 0) button = "left";
  else if (btn === 1) button = "middle";
  else if (btn === 2) button = "right";
  return {
    kind: motion ? "motion" : release ? "release" : "press",
    button,
  };
}

function parseOne(input: string, start: number): { event: SgrMouseEvent; next: number } | "pending" | undefined {
  if (!input.startsWith(`${ESC}[<`, start)) return undefined;
  let i = start + 3;
  const semi = (from: number): number | "pending" | undefined => {
    let j = from;
    while (j < input.length) {
      const c = input[j]!;
      if (c === ";" || c === "M" || c === "m") return j;
      if (c < "0" || c > "9") return undefined;
      j++;
    }
    return "pending";
  };
  const bEnd = semi(i);
  if (bEnd === "pending") return "pending";
  if (bEnd === undefined) return undefined;
  const rawButton = Number.parseInt(input.slice(i, bEnd), 10);
  if (!Number.isFinite(rawButton)) return undefined;
  i = bEnd + 1;
  const xEnd = semi(i);
  if (xEnd === "pending") return "pending";
  if (xEnd === undefined) return undefined;
  const col = Number.parseInt(input.slice(i, xEnd), 10);
  i = xEnd + 1;
  const yEnd = semi(i);
  if (yEnd === "pending") return "pending";
  if (yEnd === undefined) return undefined;
  const row = Number.parseInt(input.slice(i, yEnd), 10);
  if (yEnd >= input.length) return "pending";
  const tail = input[yEnd]!;
  if (tail !== "M" && tail !== "m") return undefined;
  const releaseChar = tail === "m";
  i = yEnd + 1;

  const shift = (rawButton & 4) !== 0;
  const alt = (rawButton & 8) !== 0;
  const ctrl = (rawButton & 16) !== 0;
  let { kind, button } = decodeButton(rawButton);
  if (releaseChar && kind !== "motion") kind = "release";

  return {
    event: {
      kind,
      button,
      col,
      row,
      shift,
      alt,
      ctrl,
      rawButton,
    },
    next: i,
  };
}

/** Parse SGR mouse sequences from `buffer + chunk`, preserving a partial trailing sequence. */
export function parseSgrMouseChunk(pending: string, chunk: string): MouseParseResult {
  const input = pending + chunk;
  const events: SgrMouseEvent[] = [];
  let i = 0;
  let rest = "";
  let hold = "";

  while (i < input.length) {
    if (input[i] !== ESC) {
      rest += input[i]!;
      i++;
      continue;
    }
    const parsed = parseOne(input, i);
    if (parsed === "pending") {
      hold = input.slice(i);
      break;
    }
    if (parsed === undefined) {
      rest += input[i]!;
      i++;
      continue;
    }
    events.push(parsed.event);
    i = parsed.next;
  }

  return { events, rest, pending: hold };
}
