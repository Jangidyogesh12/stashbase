/**
 * The workspace's content row as a drop target for files from the desktop:
 * the document pane and the chat beside it, whether or not a document is
 * open. A file dropped here opens where it is instead of being copied in;
 * Files keeps the copy, and the message box keeps attaching.
 */
import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';

import { DROP_TARGET } from '@/lib/local/drop-target';
import { useShape } from '@/lib/shape-context';
import { cn } from '@/lib/utils';
import { FloatingNotice, FloatingNotices } from '@/shared/ui/notice';

/** One account of a drop that did not fully open. */
export interface DocumentDropNotice {
  message: string;
  onDismiss: () => void;
}

/** Where a desktop file being dragged would land. */
type DropRegion = 'none' | 'open' | 'attach';

/** The message box, which attaches a dropped file rather than opening it. */
const ATTACH_TARGET = '[data-file-drop="attach"]';

function carriesFiles(dataTransfer: DataTransfer | null): boolean {
  return Array.from(dataTransfer?.types ?? []).includes('Files');
}

function attaches(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(ATTACH_TARGET) !== null;
}

export function DocumentDropZone({
  children,
  notice,
  onDropFiles,
}: {
  children: ReactNode;
  notice: DocumentDropNotice | null;
  /** Absent where a dropped file has no location to open, as in the web build. */
  onDropFiles?: ((files: File[]) => void) | undefined;
}) {
  const shape = useShape();
  const zone = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [region, setRegion] = useState<DropRegion>('none');

  // A preview frame keeps its drag events to itself, so the row learns of a
  // file drag from the whole window's document; while one is under way the
  // frames let the pointer through to the row. The listeners depend only on
  // whether drops are taken, so a re-render mid-drag keeps their count.
  const takesDrops = onDropFiles !== undefined;
  useEffect(() => {
    const element = zone.current;
    const root = element?.ownerDocument;
    if (!takesDrops || !element || !root) return;
    let depth = 0;
    const enter = (event: globalThis.DragEvent) => {
      if (!carriesFiles(event.dataTransfer)) return;
      depth += 1;
      setDragging(true);
    };
    const leave = (event: globalThis.DragEvent) => {
      if (!carriesFiles(event.dataTransfer)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) {
        setDragging(false);
        setRegion('none');
      }
    };
    const over = (event: globalThis.DragEvent) => {
      if (!carriesFiles(event.dataTransfer)) return;
      const inside = event.target instanceof Node && element.contains(event.target);
      setRegion(!inside ? 'none' : attaches(event.target) ? 'attach' : 'open');
    };
    // Lowered only once the drop has been dispatched: changing the row while
    // the event is still on its way would leave React without its target.
    const settle = () => {
      depth = 0;
      setTimeout(() => {
        setDragging(false);
        setRegion('none');
      }, 0);
    };
    root.addEventListener('dragenter', enter, true);
    root.addEventListener('dragleave', leave, true);
    root.addEventListener('dragover', over, true);
    root.addEventListener('drop', settle, true);
    root.addEventListener('dragend', settle, true);
    return () => {
      root.removeEventListener('dragenter', enter, true);
      root.removeEventListener('dragleave', leave, true);
      root.removeEventListener('dragover', over, true);
      root.removeEventListener('drop', settle, true);
      root.removeEventListener('dragend', settle, true);
    };
  }, [takesDrops]);

  // Captured before an editor sees it: a Markdown or code editor would
  // otherwise insert the dropped file into the document in front. The
  // message box keeps its own drop.
  const over = (event: DragEvent<HTMLDivElement>) => {
    if (!onDropFiles || !carriesFiles(event.dataTransfer) || attaches(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    // Copy is the operation every file source offers; Chromium drops nothing
    // a source did not allow, and opening in place reads the file all the same.
    event.dataTransfer.dropEffect = 'copy';
  };
  const drop = (event: DragEvent<HTMLDivElement>) => {
    if (!onDropFiles || !carriesFiles(event.dataTransfer) || attaches(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    const files = Array.from(event.dataTransfer.files);
    if (files.length > 0) onDropFiles(files);
  };

  return (
    <div
      className={cn(
        'relative flex h-full min-h-0 flex-col',
        dragging && '[&_iframe]:pointer-events-none',
      )}
      data-file-dragging={dragging || undefined}
      ref={zone}
      onDragOverCapture={over}
      onDropCapture={drop}
    >
      <div className="relative min-h-0 flex-1">{children}</div>
      {/* What the drop could not open has nowhere to land, so it floats over
       *  the row; dismissing it loses nothing, since Files still copies. */}
      {notice && (
        <FloatingNotices>
          <FloatingNotice onDismiss={notice.onDismiss} role="alert">
            {notice.message}
          </FloatingNotice>
        </FloatingNotices>
      )}
      {dragging &&
        region === 'open' && (
          // Only where the file will land, like an editor's drop target; it
          // opens like every other document, so nothing needs saying.
          <div
            aria-hidden="true"
            className={cn('pointer-events-none absolute inset-2 z-50', DROP_TARGET, shape.card)}
            data-testid="document-drop-veil"
          />
        )}
    </div>
  );
}
