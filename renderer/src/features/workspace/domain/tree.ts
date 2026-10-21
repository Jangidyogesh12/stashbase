/**
 * The workspace tree's own model: the listing the server sends, the node and
 * row shapes the sidebar renders, and the path arithmetic every mutation and
 * keyboard move relies on. Format vocabulary comes from the cross-process
 * `ViewerFormat`, so the listing wire and the tree cannot drift.
 */
import type { ViewerFormat } from '@/contracts/file-formats';
import { basePathName, parentPathOf } from '@/shared/utils/file-path';
import { listNavigationTarget } from '@/shared/utils/list-cursor';

export type { ViewerFormat };

type FileKind = 'regular' | 'symlink' | 'special' | 'cloud-placeholder';
type FolderKind = 'normal' | 'excluded' | 'unreadable';

export interface WorkspaceFile {
  availability: 'available' | 'unreadable';
  format: ViewerFormat;
  heading: string;
  importedAt: string;
  kind: FileKind;
  path: string;
  size: number;
  snippet: string;
}

export interface WorkspaceFolder {
  kind: FolderKind;
  path: string;
}

export interface WorkspaceListing {
  files: WorkspaceFile[];
  folderName: string;
  folders: WorkspaceFolder[];
  /** The hidden-entry visibility the server actually applied to this listing.
   *  Read back rather than assumed, so a window's menu can never disagree with
   *  the rows it is showing. */
  showHiddenFiles: boolean;
}

interface FileNode extends WorkspaceFile {
  name: string;
  type: 'file';
}

interface FolderNode extends WorkspaceFolder {
  children: TreeNode[];
  name: string;
  type: 'folder';
}

export type TreeNode = FileNode | FolderNode;

export interface TreeRow {
  depth: number;
  node: TreeNode;
  parentPath: string | null;
  position: number;
  setSize: number;
}

export type ExpandedFolders = Record<string, true>;

/** One file or folder the user can rename or delete, by folder-relative path. */
export interface WorkspaceEntry {
  kind: 'file' | 'folder';
  path: string;
}

/** The folder-relative parent of an entry; empty at the folder root. */
export function parentTreePath(entryPath: string): string {
  return parentPathOf(entryPath);
}

export function joinTreePath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name;
}

/** The name a new draft takes under `parent`: `Untitled.md`, or the first
 *  `Untitled N.md` no sibling already uses. Names are compared without case,
 *  so a case-insensitive disk cannot refuse the one chosen. */
export function untitledDraftName(listing: WorkspaceListing, parent: string): string {
  const taken = new Set(
    listing.files
      .filter((file) => parentPathOf(file.path) === parent)
      .map((file) => basePathName(file.path).toLowerCase()),
  );
  // One more candidate than there are siblings is always enough.
  for (let ordinal = 1; ordinal <= listing.files.length + 1; ordinal += 1) {
    if (!taken.has(untitledName(ordinal).toLowerCase())) return untitledName(ordinal);
  }
  return untitledName(listing.files.length + 2);
}

function untitledName(ordinal: number): string {
  return ordinal === 1 ? 'Untitled.md' : `Untitled ${ordinal}.md`;
}

/** Where a new entry goes when the reader has not said: the selected folder,
 *  or the selected file's folder, or the root when nothing is selected. A
 *  folder the listing only implies, by the entries under it, counts too. */
export function treeCreationParent(listing: WorkspaceListing, selectedPath: string | null): string {
  if (selectedPath === null) return '';
  const inside = (path: string) => path !== selectedPath && treePathWithin(path, selectedPath);
  const isFolder =
    listing.folders.some((folder) => folder.path === selectedPath || inside(folder.path)) ||
    listing.files.some((file) => inside(file.path));
  return isFolder ? selectedPath : parentPathOf(selectedPath);
}

/** The path an entry takes when only its leaf name changes. */
export function renamedTreePath(entryPath: string, name: string): string {
  return joinTreePath(parentPathOf(entryPath), name);
}

/** An entry's path as the system writes it, for the clipboard: from the disk
 *  root, or from the project folder. A Windows project folder (a drive letter
 *  or a UNC share) separates with backslashes throughout. */
export function systemEntryPath(
  folderPath: string,
  entryPath: string,
  form: 'absolute' | 'relative',
): string {
  const separator = /^(?:[A-Za-z]:[\\/]|\\\\)/u.test(folderPath) ? '\\' : '/';
  const relative = entryPath.replaceAll('/', separator);
  if (form === 'relative') return relative;
  const root = folderPath.endsWith(separator) ? folderPath : `${folderPath}${separator}`;
  return `${root}${relative}`;
}

/** True for the entry itself and everything below it. */
export function treePathWithin(entryPath: string, prefix: string): boolean {
  return entryPath === prefix || entryPath.startsWith(`${prefix}/`);
}

/** Why a typed name cannot become an entry, or null when it can. Mirrors
 *  the wire rule so the tree explains a bad name before any request. */
export function entryNameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed === '') return 'Enter a name.';
  if (/[\\/]/u.test(trimmed)) return 'A name cannot contain slashes.';
  if (trimmed === '.' || trimmed === '..') return 'That name is reserved.';
  if (trimmed.length > 255) return 'That name is too long.';
  return null;
}

function compareNodes(left: TreeNode, right: TreeNode): number {
  if (left.type !== right.type) return left.type === 'folder' ? -1 : 1;
  return left.name.localeCompare(right.name, undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

export function buildTree(listing: WorkspaceListing): TreeNode[] {
  const roots: TreeNode[] = [];
  const folders = new Map<string, FolderNode>();

  const ensureFolder = (folderPath: string, kind: FolderKind = 'normal'): FolderNode => {
    const existing = folders.get(folderPath);
    if (existing) {
      if (kind !== 'normal') existing.kind = kind;
      return existing;
    }
    const node: FolderNode = {
      children: [],
      kind,
      name: basePathName(folderPath),
      path: folderPath,
      type: 'folder',
    };
    const parent = parentPathOf(folderPath);
    if (parent) ensureFolder(parent).children.push(node);
    else roots.push(node);
    folders.set(folderPath, node);
    return node;
  };

  for (const folder of listing.folders) ensureFolder(folder.path, folder.kind);
  for (const file of listing.files) {
    const node: FileNode = { ...file, name: basePathName(file.path), type: 'file' };
    const parent = parentPathOf(file.path);
    if (parent) ensureFolder(parent).children.push(node);
    else roots.push(node);
  }

  const sort = (nodes: TreeNode[]) => {
    nodes.sort(compareNodes);
    for (const node of nodes) if (node.type === 'folder') sort(node.children);
  };
  sort(roots);
  return roots;
}

export function folderIsRestricted(folder: WorkspaceFolder): boolean {
  return folder.kind === 'excluded' || folder.kind === 'unreadable';
}

export function fileIsRestricted(file: WorkspaceFile): boolean {
  return file.availability === 'unreadable' || file.kind !== 'regular';
}

export function visibleTree(nodes: TreeNode[], expanded: ExpandedFolders): TreeRow[] {
  const rows: TreeRow[] = [];
  const visit = (siblings: TreeNode[], depth: number, parent: string | null) => {
    siblings.forEach((node, index) => {
      rows.push({
        depth,
        node,
        parentPath: parent,
        position: index + 1,
        setSize: siblings.length,
      });
      if (node.type === 'folder' && !folderIsRestricted(node) && expanded[node.path] === true) {
        visit(node.children, depth + 1, node.path);
      }
    });
  };
  visit(nodes, 1, null);
  return rows;
}

export function nextTreePath(
  key: string,
  currentPath: string | null,
  rows: readonly TreeRow[],
): string | null {
  if (rows.length === 0) return null;
  const activeIndex = Math.max(
    0,
    rows.findIndex((row) => row.node.path === currentPath),
  );
  // The linear half of the tree's keyboard is the same cursor every other list
  // in the app runs, so the tree reads it from there instead of restating the
  // arithmetic. It declares no page size: the tree owns the horizontal moves
  // that open and close folders, and a page jump past a collapsed folder is
  // not a move a reader can follow.
  const target = listNavigationTarget(key, { activeIndex, count: rows.length });
  return target === null ? null : (rows[target]?.node.path ?? null);
}
