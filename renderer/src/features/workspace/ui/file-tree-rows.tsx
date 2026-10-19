/**
 * One line of the file tree: its icon vocabulary, its indentation and rails,
 * and the button that carries the row's semantics.
 *
 * The row owns no tree state. Everything it needs to draw itself arrives as a
 * value and everything it can do leaves as a callback, so the tree component
 * stays the single place that decides what a gesture means.
 */
import {
  ChevronDown,
  ChevronRight,
  CircleSlash,
  ExternalLink,
  FileAudio,
  FileCode2,
  FileImage,
  FileJson2,
  FileQuestion,
  FileText,
  FileType2,
  Folder,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import type { CSSProperties, KeyboardEvent, MouseEvent } from 'react';

import { Button } from '@/components/ui/button';
import { caretOffsetAtPoint } from '@/components/ui/inline-input';
import type { ViewerFormat } from '@/features/workspace/domain/tree';
import {
  fileIsRestricted,
  folderIsRestricted,
  type TreeRow,
  type WorkspaceEntry,
} from '@/features/workspace/domain/tree';
import { cn } from '@/lib/utils';

import { writeTreeDrag } from './file-tree-drop';

// The tree sits on the sidebar's row, the compact step: 28px tall with the
// 14px glyph and 13px label every other row in the column has, so the
// folder header, New chat, the footer, and the tree read as one list. A
// level indents by the glyph plus 12px.
const TREE_ROOT_INSET = 8;
const TREE_LEVEL_INDENT = 26;
const TREE_ICON_RADIUS = 7;

const FILE_ICONS: Record<ViewerFormat, LucideIcon> = {
  audio: FileAudio,
  docx: FileText,
  generic: FileQuestion,
  html: FileCode2,
  image: FileImage,
  json: FileJson2,
  md: FileText,
  pdf: FileType2,
  txt: FileText,
};

/** Preparation states that need the user. Pending work stays unmarked. */
export interface FileTreeRowMarker {
  kind: 'cancelled' | 'failed';
  title: string;
}

const MARKER_ICONS: Record<FileTreeRowMarker['kind'], LucideIcon> = {
  cancelled: CircleSlash,
  failed: TriangleAlert,
};

const GENERIC_TITLE = 'Search and automatic Chat context exclude this file.';
const GENERIC_LABEL = 'excluded from Search and automatic Chat context';

export function rowInset(depth: number): CSSProperties {
  return {
    paddingLeft: `${TREE_ROOT_INSET + (depth - 1) * TREE_LEVEL_INDENT}px`,
  };
}

/** The vertical guides that connect a nested row to its ancestors. */
export function Rails({ depth }: { depth: number }) {
  return (
    <>
      {Array.from({ length: Math.max(0, depth - 1) }, (_, level) => (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 z-10 w-px bg-border/60"
          data-tree-rail=""
          key={level}
          style={{
            left: `${TREE_ROOT_INSET + level * TREE_LEVEL_INDENT + TREE_ICON_RADIUS}px`,
          }}
        />
      ))}
    </>
  );
}

export function entryOf(row: TreeRow): WorkspaceEntry {
  return { kind: row.node.type, path: row.node.path };
}

export function rowIsRestricted(row: TreeRow): boolean {
  return row.node.type === 'folder' ? folderIsRestricted(row.node) : fileIsRestricted(row.node);
}

/** A file the project will not index, so it never joins Search or Chat context. */
function rowIsGeneric(row: TreeRow): boolean {
  return row.node.type === 'file' && row.node.format === 'generic';
}

/** The run of a name a rename should offer for replacement: the stem ahead
 *  of a file's extension, or the whole name of a folder. */
export function nameSelection(row: TreeRow): { end: number; start: number } {
  const name = row.node.name;
  const dot = row.node.type === 'file' ? name.lastIndexOf('.') : -1;
  return { end: dot > 0 ? dot : name.length, start: 0 };
}

interface RowDescription {
  marker?: FileTreeRowMarker | undefined;
  revealLabel: string;
}

/** What the row announces. A restricted entry says what activating it does,
 *  a generic one says why Search cannot see it, and a marked one carries the
 *  preparation state that needs the user. */
function rowLabel(row: TreeRow, { marker, revealLabel }: RowDescription): string {
  if (rowIsRestricted(row)) return `${row.node.name}, restricted, ${revealLabel}`;
  if (rowIsGeneric(row)) return `${row.node.name}, ${GENERIC_LABEL}`;
  return marker ? `${row.node.name}, ${marker.title}` : row.node.name;
}

/** What the row says on hover; the full path when it has nothing else to say. */
function rowTitle(row: TreeRow, { marker, revealLabel }: RowDescription): string {
  if (rowIsRestricted(row)) return revealLabel;
  if (rowIsGeneric(row)) return GENERIC_TITLE;
  return marker?.title ?? row.node.path;
}

/** The leading icon: a folder's disclosure state, or the file's format. */
export function rowIcon(row: TreeRow, expanded: boolean): LucideIcon {
  if (row.node.type !== 'folder') return FILE_ICONS[row.node.format];
  if (rowIsRestricted(row)) return Folder;
  return expanded ? ChevronDown : ChevronRight;
}

export interface FileTreeRowProps {
  expanded: boolean;
  /** The active folder, for the source identity a drag carries. */
  folderPath: string;
  index: number;
  marker?: FileTreeRowMarker | undefined;
  onActivate(row: TreeRow): void;
  /** A drag the row started has ended, wherever it was dropped. */
  onDragEnd(): void;
  /** The row's own drag began; its payload is already written. */
  onDragStart(row: TreeRow): void;
  onFocus(path: string): void;
  /** A double click on a file: the reader asking for its document to stay
   *  open rather than be the preview the next click replaces. */
  onKeep(row: TreeRow): void;
  onKeyDown(event: KeyboardEvent<HTMLButtonElement>, row: TreeRow, editable: boolean): void;
  onRename(row: TreeRow, caretOffset?: number): void;
  proximityActive: boolean;
  registerRow(path: string, element: HTMLButtonElement | null): void;
  revealLabel: string;
  row: TreeRow;
  selected: boolean;
  tabStop: boolean;
}

export function FileTreeRow({
  expanded,
  folderPath,
  index,
  marker,
  onActivate,
  onDragEnd,
  onDragStart,
  onFocus,
  onKeep,
  onKeyDown,
  onRename,
  proximityActive,
  registerRow,
  revealLabel,
  row,
  selected,
  tabStop,
}: FileTreeRowProps) {
  const restricted = rowIsRestricted(row);
  const editable = !restricted;
  const generic = rowIsGeneric(row);
  // Any entry the tree may rename can move into another folder. Only a file
  // Chat can read also carries its source identity for the composer.
  const draggable = !restricted;
  const trailingIcon = restricted ? ExternalLink : marker ? MARKER_ICONS[marker.kind] : undefined;

  // A click acts at once: a folder toggle is the tree's most frequent gesture
  // and must not wait out a double-click window. Only the first click of a
  // double click acts, so the second lands on the folder as that click left
  // it, or on a file already previewed.
  const onClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (event.detail > 1) return;
    onActivate(row);
  };

  // A double click keeps a file's document open; on a folder it starts the
  // rename, which a file still reaches through F2 and the menu.
  const onDoubleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (!editable) return;
    event.preventDefault();
    if (row.node.type === 'file') {
      onKeep(row);
      return;
    }
    const target = event.target instanceof HTMLElement ? event.target : event.currentTarget;
    onRename(row, caretOffsetAtPoint(target, event.clientX, event.clientY));
  };

  return (
    <div className="relative z-10" role="none">
      <Rails depth={row.depth} />
      <Button
        active={selected}
        aria-expanded={row.node.type === 'folder' && !restricted ? expanded : undefined}
        aria-label={rowLabel(row, { marker, revealLabel })}
        aria-level={row.depth}
        aria-posinset={row.position}
        aria-selected={selected}
        aria-setsize={row.setSize}
        className={cn(
          // gap-2 over the compact button gap lands the label on the sidebar's
          // menu rows' text line, 38px in, so the tree and the rows around it
          // share one text edge.
          'w-full justify-start gap-2',
          '[&>span:last-child]:w-full [&>span:last-child]:min-w-0 [&>span:last-child]:justify-start',
          '[&>span:last-child>span]:min-w-0 [&>span:last-child>span]:flex-1 [&>span:last-child>span]:truncate [&>span:last-child>span]:text-left [&>span:last-child>span]:[text-box:normal]',
          // The row rests in ink, label and glyph alike, over the ghost
          // button's grey, the way the sidebar's menu rows do; hovered and
          // selected are one treatment, the one row tint, with neither colour
          // nor stroke changing. The important stroke holds the button's own
          // hover thickening off.
          'text-foreground [&_svg]:stroke-[1.5]! [&_svg]:text-foreground',
          // A trailing glyph sits on the row's action axis, 18px in from the
          // edge (a 24px action box at right-1.5): 11px of padding centres the
          // 14px glyph there, where the compact button's 12px would not.
          trailingIcon !== undefined && 'pr-[11px]',
          // The reveal glyph on a restricted row is a trailing control, and
          // trailing controls in this column show under the pointer or focus,
          // not at rest: the row already says what it is by carrying a folder
          // glyph where a browsable folder carries its chevron. A preparation
          // marker is a status and stays.
          restricted &&
            '[&_svg:last-of-type]:transition-opacity [&_svg:last-of-type]:duration-fast focus-visible:[&_svg:last-of-type]:opacity-100',
          restricted && !(proximityActive || selected) && '[&_svg:last-of-type]:opacity-0',
        )}
        data-path={row.node.path}
        data-proximity-index={index}
        draggable={draggable}
        leadingIcon={rowIcon(row, expanded)}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        onDragEnd={onDragEnd}
        onDragStart={(event) => {
          if (!draggable) {
            event.preventDefault();
            return;
          }
          writeTreeDrag(
            event.dataTransfer,
            row.node.path,
            row.node.type === 'file' && !generic ? { folderPath, path: row.node.path } : null,
          );
          onDragStart(row);
        }}
        onFocus={() => onFocus(row.node.path)}
        onKeyDown={(event) => onKeyDown(event, row, editable)}
        ref={(element) => registerRow(row.node.path, element)}
        role="treeitem"
        size="compact"
        style={
          {
            ...(selected ? {} : { '--hover': 'transparent' }),
            ...rowInset(row.depth),
          } as CSSProperties
        }
        tabIndex={tabStop ? 0 : -1}
        title={rowTitle(row, { marker, revealLabel })}
        {...(trailingIcon === undefined ? {} : { trailingIcon })}
        variant="ghost"
      >
        {row.node.name}
      </Button>
    </div>
  );
}
