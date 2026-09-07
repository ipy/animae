import { EventEmitter } from "node:events";
import type { SgrMouseEvent } from "./mouse-sgr.ts";

/** Mouse events stripped from real stdin before Ink sees them (see preparsed-stdin). */
export const preparsedMouseBus = new EventEmitter();

export function emitPreparsedMouse(ev: SgrMouseEvent): void {
  preparsedMouseBus.emit("sgr", ev);
}
