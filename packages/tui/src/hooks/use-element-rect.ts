import { useLayoutEffect, useState, type RefObject } from "react";
import { measureElement, type DOMElement, type ElementMetrics } from "ink";

export type ElementRect = ElementMetrics & { hasMeasured: boolean };

const empty: ElementRect = {
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  clientWidth: 0,
  clientHeight: 0,
  hasMeasured: false,
};

/** Layout rect in live-region coordinates; re-measures when `deps` change. */
export function useElementRect(
  ref: RefObject<DOMElement | null>,
  deps: readonly unknown[] = [],
): ElementRect {
  const [rect, setRect] = useState<ElementRect>(empty);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) {
      setRect(empty);
      return;
    }
    const m = measureElement(node);
    const hasMeasured = m.width > 0 || m.height > 0;
    setRect({ ...m, hasMeasured });
  }, [ref, ...deps]);

  return rect;
}

/** Measure on demand (e.g. inside mouse handlers). */
export function measureRefRect(ref: RefObject<DOMElement | null>): ElementRect {
  const node = ref.current;
  if (!node) return empty;
  const m = measureElement(node);
  return { ...m, hasMeasured: m.width > 0 || m.height > 0 };
}
