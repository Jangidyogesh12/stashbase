import { act, cleanup, render, waitFor } from '@testing-library/react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { afterEach, expect, it, vi } from 'vite-plus/test';

import { PdfPage } from './page';

vi.mock('pdfjs-dist', () => ({
  TextLayer: class {
    cancel() {}
    async render() {}
  },
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const noop = () => undefined;

function fixture({ pending = false } = {}) {
  let intersect: (visible: boolean) => void = noop;
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: IntersectionObserverCallback) {
        intersect = (visible) =>
          callback([{ isIntersecting: visible } as IntersectionObserverEntry], this as never);
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('devicePixelRatio', 2);
  const draw = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: draw,
  } as unknown as CanvasRenderingContext2D);
  let reject: (error: Error) => void = noop;
  const promise = pending
    ? new Promise<void>((_, fail) => {
        reject = fail;
      })
    : Promise.resolve();
  let scratch: HTMLCanvasElement | undefined;
  const cancel = vi.fn(() =>
    reject(Object.assign(new Error('cancelled'), { name: 'RenderingCancelledException' })),
  );
  const page = {
    cleanup: vi.fn(),
    getViewport: ({ scale }: { scale: number }) => ({
      height: 792 * scale,
      scale,
      width: 612 * scale,
    }),
    render: vi.fn(({ canvas }: { canvas: HTMLCanvasElement }) => {
      scratch = canvas;
      return { cancel, promise };
    }),
    streamTextContent: vi.fn(),
  };
  const pdf = { getPage: vi.fn(async () => page) } as unknown as PDFDocumentProxy;
  const view = render(
    <PdfPage document={pdf} pageNumber={1} placeholder={{ height: 792, width: 612 }} scale={3} />,
  );
  return { cancel, draw, intersect, page, pdf, scratch: () => scratch, view };
}

it('bounds raster allocation at high DPI and zoom while keeping the full page layout', async () => {
  const test = fixture();
  await waitFor(() => expect(test.draw).toHaveBeenCalledOnce());
  const canvas = test.view.container.querySelector('canvas'); // dom-contract: backing-store allocation is the measured resource.
  if (!canvas) throw new Error('Missing visible canvas');
  expect(canvas).not.toBeNull();
  expect(canvas.width * canvas.height).toBeLessThanOrEqual(4 * 1024 * 1024);
  expect(canvas.style.width).toBe('1836px');
  expect(canvas.style.height).toBe('2376px');
  const scratch = test.scratch();
  if (!scratch) throw new Error('Missing scratch canvas');
  expect(scratch.width * scratch.height).toBe(0);
});

it('releases displayed backing storage as soon as a page leaves the viewport', async () => {
  const test = fixture();
  await waitFor(() => expect(test.draw).toHaveBeenCalledOnce());
  const canvas = test.view.container.querySelector('canvas'); // dom-contract: retain the detached backing store to verify disposal.
  if (!canvas) throw new Error('Missing visible canvas');
  expect(canvas.width * canvas.height).toBeGreaterThan(0);
  act(() => test.intersect(false));
  expect(canvas.width * canvas.height).toBe(0);
  expect(test.page.cleanup).toHaveBeenCalled();
});

it('keeps the drawn page through a zoom until its new rendering replaces it', async () => {
  const test = fixture();
  await waitFor(() => expect(test.draw).toHaveBeenCalledOnce());
  const canvas = test.view.container.querySelector('canvas'); // dom-contract: the drawn backing store is what stays on screen.
  if (!canvas) throw new Error('Missing visible canvas');
  const drawn = canvas.width * canvas.height;
  test.page.render.mockReturnValue({ cancel: test.cancel, promise: new Promise<void>(noop) });
  test.view.rerender(
    <PdfPage
      document={test.pdf}
      pageNumber={1}
      placeholder={{ height: 792, width: 612 }}
      scale={2}
    />,
  );
  await waitFor(() => expect(test.page.render).toHaveBeenCalledTimes(2));
  expect(drawn).toBeGreaterThan(0);
  expect(canvas.width * canvas.height).toBe(drawn);
});

it('cancels an in-flight page and releases its scratch buffer without publishing stale pixels', async () => {
  const test = fixture({ pending: true });
  await waitFor(() => expect(test.page.render).toHaveBeenCalledOnce());
  const scratch = test.scratch();
  if (!scratch) throw new Error('Missing scratch canvas');
  expect(scratch.width * scratch.height).toBeGreaterThan(0);
  test.view.unmount();
  await waitFor(() => expect(scratch.width * scratch.height).toBe(0));
  expect(test.cancel).toHaveBeenCalledOnce();
  expect(test.draw).not.toHaveBeenCalled();
});
