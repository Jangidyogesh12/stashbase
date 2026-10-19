/**
 * Dropping onto the Files tree. Every drop lands in a folder: the folder row
 * under the pointer, the folder that holds the file row under it, or the root
 * from anywhere else in the Files column, the project's own row and the empty
 * space below the tree included. A file or folder dragged from this tree
 * moves there, a folder never into itself; files dragged in from the desktop
 * are imported there. A closed folder the drag rests on opens, so a drop can
 * reach inside.
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

import {
  folderIsRestricted,
  parentTreePath,
  treePathWithin,
  type ExpandedFolders,
  type TreeRow,
  type WorkspaceEntry,
} from '@/features/workspace/domain/tree';
import type { ItemRect } from '@/lib/proximity-geometry';
import type { SourceReference } from '@/shared/domain/source-reference';
import { writeSourceDrag } from '@/shared/utils/source-drag';

import { rowAtTarget } from './file-tree-model';

/** A row dragged inside the tree. Only the tree that started the drag knows
 *  which entry it carries, so a row dropped on another window moves nothing. */
const TREE_ENTRY_MIME = 'application/x-stashbase-tree-entry';
/** What the platform names a drag of files from the desktop. */
const DESKTOP_FILES = 'Files';
/** How long a drag rests on a closed folder before the folder opens. */
export const SPRING_OPEN_MS = 600;
/** Sidebar regions whose space is never the tree's. */
const FOREIGN_DROP_OWNERS =
  '[data-sidebar="header"], [data-sidebar="footer"], [role="tablist"], [role="dialog"], [role="menu"]';

/** Starts a row drag: the tree's own entry, plus the source identity the
 *  composer reads when the file is one it can attach. */
export function writeTreeDrag(
  dataTransfer: DataTransfer,
  entryPath: string,
  source: SourceReference | null,
): void {
  if (source) writeSourceDrag(dataTransfer, source);
  dataTransfer.setData(TREE_ENTRY_MIME, entryPath);
  dataTransfer.effectAllowed = 'copyMove';
}

/** The folder a drop over `row` lands in: a folder row's own path, a file
 *  row's parent, or the root for the tree's space. Null for a restricted
 *  folder, which takes nothing. */
function dropFolderOf(row: TreeRow | undefined): string | null {
  if (!row) return '';
  if (row.node.type === 'folder') return folderIsRestricted(row.node) ? null : row.node.path;
  return row.parentPath ?? '';
}

/** The surface a drop into `folder` covers: the folder's row and every row
 *  shown inside it, or every row for the root. */
export function dropRegion(
  rows: readonly TreeRow[],
  rects: readonly ItemRect[],
  folder: string | null,
): ItemRect | null {
  if (folder === null) return null;
  let top = Infinity;
  let bottom = -Infinity;
  let left = Infinity;
  let right = -Infinity;
  rows.forEach((row, index) => {
    const rect = rects[index];
    if (!rect || (folder !== '' && !treePathWithin(row.node.path, folder))) return;
    top = Math.min(top, rect.top);
    bottom = Math.max(bottom, rect.top + rect.height);
    left = Math.min(left, rect.left);
    right = Math.max(right, rect.left + rect.width);
  });
  return top === Infinity ? null : { height: bottom - top, left, top, width: right - left };
}

function carriesTreeDrop(dataTransfer: DataTransfer): boolean {
  const types = new Set(dataTransfer.types);
  return types.has(TREE_ENTRY_MIME) || types.has(DESKTOP_FILES);
}

export interface TreeDropOptions {
  /** Imports desktop files into a folder; absent where the tree takes none. */
  importDrop?:
    | { disabled: boolean; drop(dataTransfer: DataTransfer, parentPath: string): void }
    | undefined;
  /** Changes when the listing settles, since the section exists only then. */
  listingKey: string;
  operations: {
    moveEntry(entry: WorkspaceEntry, parentPath: string): Promise<void>;
    pending: boolean;
  };
  rows: readonly TreeRow[];
  section: RefObject<HTMLElement | null>;
  tree: { expand(folderPath: string): void; expanded: ExpandedFolders };
}

/**
 * The Files column's drop target. One set of listeners on the sidebar frame
 * reads where a drag would land, so the rows, the gaps between them, and the
 * space around the tree answer as one surface. The band, the footer, the strip,
 * and a column showing another panel are not the tree's, and a drag there
 * passes on untouched.
 */
export function useTreeDrop(options: TreeDropOptions) {
  const latest = useRef(options);
  latest.current = options;
  const dragged = useRef<WorkspaceEntry | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const opening = useRef<{ path: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const leaving = useRef<number | null>(null);

  const openAfterRest = useCallback((path: string | null) => {
    if (opening.current?.path === path) return;
    if (opening.current) clearTimeout(opening.current.timer);
    opening.current =
      path === null
        ? null
        : {
            path,
            timer: setTimeout(() => {
              opening.current = null;
              latest.current.tree.expand(path);
            }, SPRING_OPEN_MS),
          };
  }, []);

  const clear = useCallback(() => {
    if (leaving.current !== null) cancelAnimationFrame(leaving.current);
    leaving.current = null;
    openAfterRest(null);
    setTarget(null);
  }, [openAfterRest]);

  const startDrag = useCallback((row: TreeRow) => {
    dragged.current = { kind: row.node.type, path: row.node.path };
  }, []);

  const endDrag = useCallback(() => {
    dragged.current = null;
    clear();
  }, [clear]);

  const { listingKey, section } = options;
  useEffect(() => {
    const element = section.current;
    if (!element) return;
    const frame = element.closest<HTMLElement>('[data-sidebar="sidebar"]') ?? element;

    /** Where a drag at this event would land, or undefined when the spot is
     *  not the tree's. A null folder is the tree's spot that takes nothing. */
    const landing = (event: DragEvent): { folder: string | null; row?: TreeRow } | undefined => {
      const node = event.target;
      if (!(node instanceof Element) || element.closest('[hidden], [inert]')) return undefined;
      if (element.contains(node)) {
        const row = rowAtTarget(latest.current.rows, node);
        return row ? { folder: dropFolderOf(row), row } : { folder: '' };
      }
      return node.closest(FOREIGN_DROP_OWNERS) ? undefined : { folder: '' };
    };

    /** What dropping this drag into `folder` does, or null for nothing. */
    const effectOf = (dataTransfer: DataTransfer, folder: string | null) => {
      if (folder === null) return null;
      const { importDrop, operations } = latest.current;
      if (Array.from(dataTransfer.types).includes(TREE_ENTRY_MIME)) {
        const entry = dragged.current;
        if (!entry || operations.pending || parentTreePath(entry.path) === folder) return null;
        return entry.kind === 'folder' && treePathWithin(folder, entry.path) ? null : 'move';
      }
      return importDrop && !importDrop.disabled ? 'copy' : null;
    };

    const onDragOver = (event: DragEvent) => {
      if (!event.dataTransfer || !carriesTreeDrop(event.dataTransfer)) return;
      const spot = landing(event);
      if (!spot) {
        clear();
        return;
      }
      // The spot is the tree's, so nothing behind it may take the drop, even
      // when the tree itself refuses it.
      event.preventDefault();
      event.stopPropagation();
      if (leaving.current !== null) cancelAnimationFrame(leaving.current);
      leaving.current = null;
      const effect = effectOf(event.dataTransfer, spot.folder);
      event.dataTransfer.dropEffect = effect ?? 'none';
      setTarget(effect ? spot.folder : null);
      // Only a folder that would take the drop opens, so a dragged folder
      // resting on itself stays closed.
      const row = spot.row;
      openAfterRest(
        effect && row?.node.type === 'folder' && !latest.current.tree.expanded[row.node.path]
          ? row.node.path
          : null,
      );
    };

    // A leave inside the frame is followed at once by the next element's
    // dragover, so only a leave that no dragover answers clears the target.
    const onDragLeave = (event: DragEvent) => {
      const next = event.relatedTarget;
      if (next instanceof Node && frame.contains(next)) return;
      if (leaving.current === null) leaving.current = requestAnimationFrame(clear);
    };

    const onDrop = (event: DragEvent) => {
      if (!event.dataTransfer || !carriesTreeDrop(event.dataTransfer)) return;
      const spot = landing(event);
      if (!spot) return;
      event.preventDefault();
      event.stopPropagation();
      const effect = effectOf(event.dataTransfer, spot.folder);
      const entry = dragged.current;
      clear();
      if (spot.folder === null) return;
      if (effect === 'move' && entry) void latest.current.operations.moveEntry(entry, spot.folder);
      if (effect === 'copy') {
        if (spot.folder) latest.current.tree.expand(spot.folder);
        latest.current.importDrop?.drop(event.dataTransfer, spot.folder);
      }
    };

    // Entering a new element answers for that step on its own, before any
    // dragover there, so a drop right after it must already be accepted.
    frame.addEventListener('dragenter', onDragOver);
    frame.addEventListener('dragover', onDragOver);
    frame.addEventListener('dragleave', onDragLeave);
    frame.addEventListener('drop', onDrop);
    return () => {
      frame.removeEventListener('dragenter', onDragOver);
      frame.removeEventListener('dragover', onDragOver);
      frame.removeEventListener('dragleave', onDragLeave);
      frame.removeEventListener('drop', onDrop);
      clear();
    };
  }, [clear, listingKey, openAfterRest, section]);

  return { endDrag, startDrag, target };
}
