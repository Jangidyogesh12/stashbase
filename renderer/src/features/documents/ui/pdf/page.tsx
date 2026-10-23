/** Owns one nearby PDF page, its cancellable rendering and bounded raster storage. */
import { TextLayer, type PDFDocumentProxy, type PDFPageProxy } from 'pdfjs-dist';
import { useEffect, useRef, useState } from 'react';

import { useErrorReporter } from '@/shared/runtime/error-reporting';

// One backing store stays within 16 MiB even on high-DPI displays at 300%.
// CSS dimensions and text coordinates retain the requested zoom.
const MAX_RASTER_PIXELS = 4 * 1024 * 1024;
const MAX_RASTER_EDGE = 4096;

export function PdfPage({
  document: pdf,
  pageNumber,
  placeholder,
  scale,
}: {
  document: PDFDocumentProxy;
  pageNumber: number;
  placeholder: { height: number; width: number };
  scale: number;
}) {
  const reportError = useErrorReporter();
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [nearViewport, setNearViewport] = useState(pageNumber <= 2);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof IntersectionObserver === 'undefined') {
      setNearViewport(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setNearViewport(entry?.isIntersecting ?? false),
      { rootMargin: '600px 0px' },
    );
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  // Resizing to zero releases a canvas's backing store; clearRect and DOM
  // removal do not. That happens when the page leaves view or closes, never on
  // a zoom, so the drawn page stays until its new rendering replaces it.
  useEffect(() => {
    if (!nearViewport) return;
    const visibleCanvas = canvasRef.current;
    const visibleText = textRef.current;
    return () => {
      if (visibleCanvas) visibleCanvas.width = visibleCanvas.height = 0;
      visibleText?.replaceChildren();
    };
  }, [nearViewport]);

  useEffect(() => {
    if (!nearViewport) return;
    let rendered: HTMLCanvasElement | null = null;
    let cancelled = false;
    let page: PDFPageProxy | null = null;
    let renderTask: ReturnType<PDFPageProxy['render']> | null = null;
    let textLayer: TextLayer | null = null;
    setFailed(false);
    void pdf
      .getPage(pageNumber)
      .then(async (loadedPage) => {
        if (cancelled) {
          loadedPage.cleanup();
          return;
        }
        page = loadedPage;
        const viewport = loadedPage.getViewport({ scale });
        const ratio = Math.min(
          globalThis.devicePixelRatio || 1,
          Math.sqrt(MAX_RASTER_PIXELS / (viewport.width * viewport.height)),
          MAX_RASTER_EDGE / Math.max(viewport.width, viewport.height),
        );
        rendered = globalThis.document.createElement('canvas');
        rendered.width = Math.max(1, Math.floor(viewport.width * ratio));
        rendered.height = Math.max(1, Math.floor(viewport.height * ratio));
        renderTask = loadedPage.render({
          canvas: rendered,
          transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
          viewport,
        });
        const textHost = globalThis.document.createElement('div');
        textLayer = new TextLayer({
          container: textHost,
          textContentSource: loadedPage.streamTextContent(),
          viewport,
        });
        const textReady = textLayer
          .render()
          .then(() => true)
          .catch(() => false);
        await renderTask.promise;
        const hasText = await textReady;
        if (cancelled) return;
        const canvas = canvasRef.current;
        const context = canvas?.getContext('2d');
        if (!canvas || !context) return;
        canvas.width = rendered.width;
        canvas.height = rendered.height;
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        context.drawImage(rendered, 0, 0);
        const layer = textRef.current;
        if (layer && hasText) {
          layer.setAttribute('style', textHost.getAttribute('style') ?? '');
          layer.style.setProperty(
            '--total-scale-factor',
            String(viewport.scale * (viewport.userUnit || 1)),
          );
          const rotation = textHost.getAttribute('data-main-rotation');
          if (rotation) layer.setAttribute('data-main-rotation', rotation);
          else layer.removeAttribute('data-main-rotation');
          layer.replaceChildren(...Array.from(textHost.childNodes));
        }
      })
      .catch((error: unknown) => {
        if (!cancelled && (error as { name?: string })?.name !== 'RenderingCancelledException') {
          reportError?.(error, 'pdf-preview');
          setFailed(true);
        }
      })
      .finally(() => {
        // Wait for cancelled rendering to settle before resizing its target.
        if (rendered) rendered.width = rendered.height = 0;
        page?.cleanup();
      });
    return () => {
      cancelled = true;
      renderTask?.cancel();
      textLayer?.cancel();
      page?.cleanup();
    };
  }, [nearViewport, pageNumber, pdf, scale, reportError]);

  return (
    <div
      aria-label={`Page ${pageNumber}`}
      className="relative shrink-0 overflow-hidden bg-surface-3 shadow-surface-3"
      data-page={pageNumber}
      ref={rootRef}
      role="group"
      style={{ height: placeholder.height * scale, width: placeholder.width * scale }}
    >
      {failed ? (
        <div className="flex h-full items-center justify-center text-caption text-muted-foreground">
          Page {pageNumber} could not be rendered
        </div>
      ) : nearViewport ? (
        <>
          <canvas aria-hidden="true" className="block" ref={canvasRef} />
          <div className="stashbase-pdf-text-layer" ref={textRef} />
        </>
      ) : (
        <span className="sr-only">Page {pageNumber} is outside the visible area</span>
      )}
    </div>
  );
}
