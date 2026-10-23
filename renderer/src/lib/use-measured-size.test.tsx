import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import { useMeasuredSize } from './use-measured-size';

// happy-dom computes no layout, so every metric the hook reads is pinned here
// and the observed resize is fired by hand.
let resized: () => void = () => undefined;
let disconnects = 0;

beforeEach(() => {
  resized = () => undefined;
  disconnects = 0;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resized = callback;
      }
      observe() {}
      unobserve() {}
      disconnect() {
        disconnects += 1;
      }
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function pin(element: Element, metric: 'offsetHeight', value: number): void {
  Object.defineProperty(element, metric, { configurable: true, value });
}

/** A measured element inside the clipping parent every collapse gives it. */
function region() {
  const parent = document.createElement('div');
  const node = document.createElement('div');
  parent.append(node);
  document.body.append(parent);
  return { node, parent };
}

describe('useMeasuredSize', () => {
  it('publishes the element height on attach and follows it on resize', () => {
    const { result } = renderHook(() => useMeasuredSize<HTMLDivElement>());
    const { node } = region();
    pin(node, 'offsetHeight', 120);

    act(() => result.current.ref(node));
    expect(result.current.size).toBe(120);
    expect(result.current.element.current).toBe(node);

    pin(node, 'offsetHeight', 260);
    act(() => resized());
    expect(result.current.size).toBe(260);
  });

  it('refuses a zero measurement by default and keeps the last real one', () => {
    const { result } = renderHook(() => useMeasuredSize<HTMLDivElement>());
    const { node } = region();
    pin(node, 'offsetHeight', 0);

    act(() => result.current.ref(node));
    expect(result.current.size).toBeNull();

    pin(node, 'offsetHeight', 90);
    act(() => resized());
    expect(result.current.size).toBe(90);

    // Collapsing to display:none must not throw away the height the reopening
    // animation needs.
    pin(node, 'offsetHeight', 0);
    act(() => resized());
    expect(result.current.size).toBe(90);
  });

  it('adopts zero for a region that stays laid out while empty', () => {
    const { result } = renderHook(() => useMeasuredSize<HTMLDivElement>({ acceptZero: true }));
    const { node } = region();
    pin(node, 'offsetHeight', 0);

    act(() => result.current.ref(node));
    expect(result.current.size).toBe(0);
  });

  it('stops observing a node it is detached from', () => {
    const { result } = renderHook(() => useMeasuredSize<HTMLDivElement>());
    const { node } = region();
    pin(node, 'offsetHeight', 120);

    act(() => result.current.ref(node));
    expect(disconnects).toBe(0);

    act(() => result.current.ref(null));
    expect(disconnects).toBe(1);
    expect(result.current.element.current).toBeNull();
  });

  it('re-reads on demand, for a pre-paint measure on open', () => {
    const { result } = renderHook(() => useMeasuredSize<HTMLDivElement>());
    const { node } = region();
    pin(node, 'offsetHeight', 120);
    act(() => result.current.ref(node));

    pin(node, 'offsetHeight', 480);
    expect(result.current.size).toBe(120);
    act(() => result.current.measure());
    expect(result.current.size).toBe(480);
  });
});
