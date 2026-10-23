/** Live layout measurement of one element, in pixels.
 *
 *  Every collapse in this project animates to a measured pixel value rather
 *  than `height: "auto"` / `width: "auto"`: framer resolves an "auto" target
 *  from the element's *visual* (transformed) size, so under a scaled ancestor
 *  the region springs out to scale × its real size and snaps back when the
 *  final "auto" lands. `offsetHeight`, `offsetWidth` and
 *  ResizeObserver are all transform-immune, so what comes back here is the
 *  layout value whatever the ancestors do to it.
 *
 *  Height and width are the same machinery, so they are the same hook read on
 *  two axes rather than two observers written twice — the collapsing tab label
 *  in the subtle strip had its own copy, which is the sort of copy that
 *  quietly stops disconnecting. */

import { useCallback, useRef, useState, type RefObject } from 'react';

interface MeasuredSizeOptions {
  /** Which axis to read. @default "height" */
  axis?: 'height' | 'width';
  /**
   * Whether a measurement of 0 is real. Off by default: a collapsed region is
   * usually `display: none` at that moment, and adopting its 0 would throw
   * away the height the reopening animation needs. Regions that stay laid out
   * while collapsed — and can legitimately be empty — turn it on.
   */
  acceptZero?: boolean;
}

interface MeasuredSize<T extends HTMLElement> {
  /** Attach to the element being measured. Stable for the element's life. */
  ref: (element: T | null) => void;
  /** The measured element, for callers that also need the node itself. */
  element: RefObject<T | null>;
  /** Latest measurement in px, or null before the first accepted one. */
  size: number | null;
  /** Re-read the size now — for a pre-paint re-measure on open. */
  measure: () => void;
}

/** Tracks one of an element's layout dimensions in pixels, live. */
export function useMeasuredSize<T extends HTMLElement>({
  axis = 'height',
  acceptZero = false,
}: MeasuredSizeOptions = {}): MeasuredSize<T> {
  const element = useRef<T | null>(null);
  const observer = useRef<ResizeObserver | null>(null);
  const [size, setSize] = useState<number | null>(null);

  const measure = useCallback(() => {
    const node = element.current;
    if (!node) return;
    const next = axis === 'width' ? node.offsetWidth : node.offsetHeight;
    if (next > 0 || acceptZero) setSize(next);
  }, [acceptZero, axis]);

  const ref = useCallback(
    (node: T | null) => {
      observer.current?.disconnect();
      observer.current = null;
      element.current = node;
      if (!node || typeof ResizeObserver === 'undefined') return;
      measure();
      const resizeObserver = new ResizeObserver(measure);
      resizeObserver.observe(node);
      observer.current = resizeObserver;
    },
    [measure],
  );

  return { ref, element, size, measure };
}
