import type { TreeRow, WorkspaceEntry } from '@/features/workspace/domain/tree';
import type { FileTreeNaming } from '@/features/workspace/hooks/use-file-operations';
import type { ItemRect } from '@/lib/proximity-geometry';

/** The rendered row an event landed on, read from the nearest row element. */
export function rowAtTarget(
  rows: readonly TreeRow[],
  target: EventTarget | null,
): TreeRow | undefined {
  const path =
    target instanceof Element
      ? target.closest<HTMLElement>('[data-path]')?.dataset.path
      : undefined;
  return path === undefined ? undefined : rows.find((row) => row.node.path === path);
}

/** One string that changes exactly when the rendered rows' paths change. */
export function renderedPathKey(rows: readonly TreeRow[]): string {
  return rows.map((row) => row.node.path).join('\u0000');
}

/** The glided hover fill's rect: the pointer's row once measured, or null
 *  while the pointer is on the selected row, which already wears the same
 *  tint and would only darken under a second one. */
export function hoverRect(
  measured: boolean,
  rects: readonly ItemRect[],
  activeIndex: number | null,
  rows: readonly TreeRow[],
  selectedPath: string | null,
): ItemRect | null {
  if (!measured || activeIndex === null) return null;
  if (rows[activeIndex]?.node.path === selectedPath) return null;
  return rects[activeIndex] ?? null;
}

/** What one line of the tree shows: a listed entry, or the draft of a new one. */
export type TreeItem =
  | { index: number; kind: 'row'; row: TreeRow }
  | { depth: number; entryKind: WorkspaceEntry['kind']; kind: 'draft'; parentPath: string };

/** A folder's visible rows in the flat model, nested for rendering so the
 *  whole group can open and close as one motion. */
export interface RenderNode {
  children: RenderNode[];
  item: TreeItem;
}

export function itemKey(item: TreeItem): string {
  return item.kind === 'row' ? item.row.node.path : `draft:${item.entryKind}:${item.parentPath}`;
}

/**
 * The rendered rows, with an open create draft placed where the new entry will
 * land: first under its parent, or at the head of the tree when it belongs to
 * the folder root.
 */
export function treeItems(
  renderedRows: readonly TreeRow[],
  naming: FileTreeNaming | null,
): TreeItem[] {
  const items: TreeItem[] = renderedRows.map((row, index) => ({ index, kind: 'row', row }));
  if (naming?.kind !== 'create') return items;
  const parentAt = renderedRows.findIndex((row) => row.node.path === naming.parentPath);
  const parent = renderedRows[parentAt];
  const draft: TreeItem = {
    depth: parent ? parent.depth + 1 : 1,
    entryKind: naming.entryKind,
    kind: 'draft',
    parentPath: naming.parentPath,
  };
  items.splice(naming.parentPath === '' ? 0 : parentAt + 1, 0, draft);
  return items;
}

/** Rebuilds the parent/child nesting the flat row model flattened away, so a
 *  folder's descendants render inside one animated group. */
export function nestTreeItems(items: readonly TreeItem[]): RenderNode[] {
  const roots: RenderNode[] = [];
  const folders = new Map<string, RenderNode>();
  for (const item of items) {
    const node: RenderNode = { children: [], item };
    const parent = item.kind === 'row' ? item.row.parentPath : item.parentPath || null;
    (parent === null ? roots : (folders.get(parent)?.children ?? roots)).push(node);
    if (item.kind === 'row' && item.row.node.type === 'folder') {
      folders.set(item.row.node.path, node);
    }
  }
  return roots;
}
