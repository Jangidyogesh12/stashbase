/** Attachments in the composer: the controlled file list, the rules that
 *  govern what may join it (`accept`, `maxFiles`, de-duplication), the two
 *  ways files arrive (a drop on the composer, the native picker), and the
 *  preview row of tiles that shows them above the editor.
 *
 *  `useComposerFiles` owns the state and the entry points; `FilePreviewRow`
 *  renders the row. Nothing here knows about the draft, the queue or the
 *  send button — a consumer's own tiles arrive as `previewSlot` and are
 *  rendered untouched. */
'use client';

import { AnimatePresence, motion } from 'framer-motion';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent as ReactDragEvent,
  type ReactNode,
} from 'react';

import { Collapse, useClippedHeight } from '@/components/internal/collapse';
import { FileThumbnail } from '@/components/ui/file-thumbnail';
import { Tooltip } from '@/components/ui/tooltip';
import { focusRing } from '@/lib/focus-ring';
import { useIcon } from '@/lib/icon-context';
import { spring } from '@/lib/springs';
import { useMotionTier } from '@/lib/use-motion-tier';
import { fileFingerprint } from '@/shared/utils/file-identity';

/** The composer's default accept list when a consumer names none. */
export const DEFAULT_ACCEPT = 'image/png,image/jpeg,application/pdf';

/** The slice of `InputMessage`'s public surface this concern owns. */
export interface InputMessageFileProps {
  /** Controlled list of attached files. When undefined, attachment behavior
   *  is disabled (no drag-drop, no file input). */
  files?: File[];
  /** Called when files are added (drag-drop or picker) or removed. */
  onFilesChange?: (files: File[]) => void;
  /** Accepted MIME types as a comma-separated string. An empty value accepts
   * every file. Defaults to PNG / JPEG / PDF. */
  accept?: string;
  /** Maximum number of files. Extra files are dropped when the limit is exceeded. */
  maxFiles?: number;
  /** Side of each preview tile in pixels. Defaults to 80. */
  filePreviewSize?: number;
  /** A drag payload other than a desktop file that the consumer takes on
   *  drop itself, such as a row dragged from the file tree. The composer
   *  lights its drop target for it as it does for a file; the drop itself is
   *  the consumer's to handle. */
  acceptsDrag?: (dataTransfer: DataTransfer) => boolean;
  /** Extra tiles rendered in the preview row ahead of the attached files,
   *  for attachments the consumer binds itself (a project mention, say).
   *  Pass it only when there is something to show; the row collapses when
   *  both it and `files` are empty. */
  previewSlot?: ReactNode;
}

interface ComposerFilesOptions {
  /** Controlled attachments. */
  files: File[] | undefined;
  /** Called with the next list. Its presence is the opt-in: without it the
   *  composer accepts no drops and renders no picker. */
  onFilesChange: ((files: File[]) => void) | undefined;
  /** Accepted MIME types or extensions, comma-separated. */
  accept: string;
  /** Cap on attachments; anything past it is dropped. */
  maxFiles: number | undefined;
  /** The composer as a whole is disabled: no drops, no picker. */
  disabled: boolean | undefined;
  /** Another payload the consumer takes; see `InputMessageFileProps`. */
  acceptsDrag: ((dataTransfer: DataTransfer) => boolean) | undefined;
}

/** Everything the composer needs to know about its attachments. */
interface ComposerFiles {
  /** The attached files, never undefined. */
  items: File[];
  /** Whether attachment behavior is wired at all. */
  supported: boolean;
  /** A drag the composer takes, a desktop file or a payload the consumer
   *  accepts, is hovering it. */
  dragOver: boolean;
  /** Opens the native picker. `acceptOverride` narrows it for one invocation. */
  openFilePicker: (acceptOverride?: string) => void;
  /** Adds files that pass `accept`, skipping duplicates and honoring `maxFiles`. */
  add: (incoming: File[]) => void;
  /** Removes the attachment at `index`. */
  remove: (index: number) => void;
  /** Replaces the whole list — a queued message coming back, or a clear on send. */
  replace: (next: File[]) => void;
  /** Spread onto the composer shell; the shell owns no drag state of its own. */
  dropHandlers: {
    onDragOver: (event: ReactDragEvent<HTMLDivElement>) => void;
    onDragLeave: (event: ReactDragEvent<HTMLDivElement>) => void;
    onDrop: (event: ReactDragEvent<HTMLDivElement>) => void;
  };
  /** The hidden native picker. Render it inside the composer; it is null when
   *  attachments are not supported. */
  input: ReactNode;
}

export function useComposerFiles({
  files,
  onFilesChange,
  accept,
  maxFiles,
  disabled,
  acceptsDrag,
}: ComposerFilesOptions): ComposerFiles {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  /** The document the drag is in, so the highlight can hear its drop. */
  const dragDocument = useRef<Document | null>(null);
  const items = useMemo(() => files ?? [], [files]);
  const supported = onFilesChange !== undefined;

  const acceptTokens = useMemo(
    () =>
      accept
        .split(',')
        .map((token) => token.trim())
        .filter(Boolean),
    [accept],
  );

  const matchesAccept = useCallback(
    (file: File) =>
      acceptTokens.length === 0 ||
      acceptTokens.some((token) => {
        if (token.endsWith('/*')) return file.type.startsWith(token.slice(0, -1));
        if (token.startsWith('.')) return file.name.toLowerCase().endsWith(token.toLowerCase());
        return file.type === token;
      }),
    [acceptTokens],
  );

  const add = useCallback(
    (incoming: File[]) => {
      if (!onFilesChange) return;
      const existing = new Set(items.map(fileFingerprint));
      const accepted: File[] = [];
      for (const file of incoming) {
        if (!matchesAccept(file)) continue;
        const key = fileFingerprint(file);
        if (existing.has(key)) continue;
        existing.add(key);
        accepted.push(file);
      }
      if (!accepted.length) return;
      const next = [...items, ...accepted];
      onFilesChange(maxFiles != null ? next.slice(0, maxFiles) : next);
    },
    [onFilesChange, items, matchesAccept, maxFiles],
  );

  const remove = useCallback(
    (index: number) => {
      if (!onFilesChange) return;
      onFilesChange(items.filter((_, i) => i !== index));
    },
    [onFilesChange, items],
  );

  const replace = useCallback(
    (next: File[]) => {
      if (!onFilesChange) return;
      onFilesChange(maxFiles != null ? next.slice(0, maxFiles) : next);
    },
    [onFilesChange, maxFiles],
  );

  const openFilePicker = useCallback(
    (acceptOverride?: string) => {
      const element = inputRef.current;
      if (!element) return;
      // Temporarily narrow `accept` for this invocation (e.g. "image/*").
      // Reset after the click so subsequent native invocations still honor
      // the component-level accept.
      if (acceptOverride) {
        element.accept = acceptOverride;
        element.click();
        // Restore on next tick — the picker dialog reads `accept` synchronously.
        queueMicrotask(() => {
          if (inputRef.current) inputRef.current.accept = accept;
        });
        return;
      }
      element.click();
    },
    [accept],
  );

  const onDragOver = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      if (disabled) return;
      // A desktop file is the composer's own drop; any other payload counts
      // only when the consumer takes it. Text and HTML drags shouldn't trigger.
      const carriesFiles = supported && Array.from(event.dataTransfer.types).includes('Files');
      if (!carriesFiles && !acceptsDrag?.(event.dataTransfer)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      dragDocument.current = event.currentTarget.ownerDocument;
      setDragOver(true);
    },
    [acceptsDrag, supported, disabled],
  );

  // A consumer that takes its own payload may stop the drop before it gets
  // here, so `onDrop` below never hears it. The drag ends wherever the drop
  // lands, so while one is over the composer the highlight also listens to
  // the whole document. It lowers only once the drop has been dispatched, as
  // the content row's drop zone does: re-rendering the field while the event
  // is still on its way could take the drop's target out from under it.
  useEffect(() => {
    const root = dragDocument.current;
    if (!dragOver || !root) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setDragOver(false));
    };
    root.addEventListener('drop', settle, true);
    root.addEventListener('dragend', settle, true);
    return () => {
      clearTimeout(timer);
      root.removeEventListener('drop', settle, true);
      root.removeEventListener('dragend', settle, true);
    };
  }, [dragOver]);

  const onDragLeave = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    const wrapper = event.currentTarget;
    const next = event.relatedTarget as Node | null;
    if (next && wrapper.contains(next)) return;
    setDragOver(false);
  }, []);

  const onDrop = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDragOver(false);
      if (!supported || disabled) return;
      add(Array.from(event.dataTransfer.files));
    },
    [supported, disabled, add],
  );

  const onInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      if (!event.target.files) return;
      add(Array.from(event.target.files));
      event.target.value = ''; // Allow re-selecting the same file.
    },
    [add],
  );

  return {
    add,
    dragOver,
    dropHandlers: { onDragLeave, onDragOver, onDrop },
    input: supported ? (
      <input
        ref={inputRef}
        type="file"
        accept={accept || undefined}
        multiple={maxFiles == null || maxFiles > 1}
        className="hidden"
        onChange={onInputChange}
        aria-hidden="true"
        tabIndex={-1}
      />
    ) : null,
    items,
    openFilePicker,
    remove,
    replace,
    supported,
  };
}

interface FilePreviewTileProps {
  file: File;
  onRemove: () => void;
  size: number;
}

/** Composer-row tile: a FileThumbnail wrapped with enter/exit motion and a
 *  hover-revealed remove (×) button. */
function FilePreviewTile({ file, onRemove, size }: FilePreviewTileProps) {
  const XIcon = useIcon('x');
  const arrive = useMotionTier(spring.fast);
  const leave = useMotionTier(spring.fast.exit);

  return (
    <motion.div
      // `layout` animates sibling tiles into the gap when one is removed.
      // Enter: spring-fast (0.08s) — the chip category per animation-guidelines.md.
      // Exit: 0.06s linear — "exits should be slightly faster than enter",
      // matches CheckboxGroup's hover-bg pattern.
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9, transition: leave }}
      transition={arrive}
      // `cursor-default` opts out of the parent's `cursor-text` so hovering
      // a preview tile doesn't look like it'll land in the textarea.
      className="group/tile relative shrink-0 cursor-default"
    >
      <FileThumbnail file={file} size={size} />
      <Tooltip content="Remove" side="top">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label={`Remove ${file.name}`}
          // Force the light-mode palette (dark circle + white X) regardless
          // of theme — the close badge needs to read as a "delete affordance"
          // over arbitrary image/PDF content, so it sits at a fixed contrast
          // instead of flipping with the surrounding surface.
          className={focusRing(
            'absolute top-1 right-1 flex h-5 w-5 cursor-pointer items-center justify-center rounded-full bg-neutral-900 text-white opacity-0 transition-opacity duration-fast outline-none group-hover/tile:opacity-100 focus-visible:opacity-100',
          )}
        >
          <XIcon size={12} strokeWidth={2.5} />
        </button>
      </Tooltip>
    </motion.div>
  );
}

interface FilePreviewRowProps {
  /** The composer's attachment state. */
  files: ComposerFiles;
  /** Consumer-owned tiles rendered ahead of the attachments, for context the
   *  composer does not hold itself. */
  previewSlot: ReactNode;
  /** Side of each tile, in pixels. */
  tileSize: number;
}

/** The attached-files preview row, above the editor. The region collapses the
 *  whole composer height when it empties; inside it, `mode="popLayout"` pulls
 *  a removing tile out of layout flow so its siblings can slide into the gap
 *  without fighting its exit animation. */
export function FilePreviewRow({ files, previewSlot, tileSize }: FilePreviewRowProps) {
  const region = useClippedHeight();

  return (
    <Collapse
      height={region.size}
      open={files.items.length > 0 || previewSlot != null}
      presence="unmount"
      regionKey="preview-row"
    >
      <div ref={region.ref} className="flex flex-wrap gap-2 pb-1">
        {previewSlot}
        <AnimatePresence initial={false} mode="popLayout">
          {files.items.map((file, index) => (
            <FilePreviewTile
              key={fileFingerprint(file)}
              file={file}
              onRemove={() => files.remove(index)}
              size={tileSize}
            />
          ))}
        </AnimatePresence>
      </div>
    </Collapse>
  );
}
