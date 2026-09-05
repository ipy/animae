import type { ElementMetrics } from "ink";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function pointInRect(col: number, row: number, rect: Rect, offsetX = 0, offsetY = 0): boolean {
  const x = col - offsetX;
  const y = row - offsetY;
  return x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
}

export function metricsToRect(m: ElementMetrics): Rect {
  return { x: m.x, y: m.y, width: m.width, height: m.height };
}

/** Find topmost target containing (col, row). `col`/`row` are 0-based terminal cells. */
export function hitTestTopmost<T extends { rect: Rect; offsetX?: number; offsetY?: number }>(
  targets: T[],
  col: number,
  row: number,
): T | undefined {
  for (let i = targets.length - 1; i >= 0; i--) {
    const t = targets[i]!;
    if (pointInRect(col, row, t.rect, t.offsetX ?? 0, t.offsetY ?? 0)) return t;
  }
  return undefined;
}
