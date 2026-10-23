/**
 * The two rows that hold a name being typed: the draft of an entry that does
 * not exist yet, and an existing row taking a new name. Both sit at the exact
 * inset of the row they stand in for, so naming never moves the tree under the
 * pointer.
 */
import { FileText, Folder } from 'lucide-react';

import type { TreeRow, WorkspaceEntry } from '@/features/workspace/domain/tree';

import { FileTreeNameRow } from './file-tree-name-row';
import { nameSelection, rowIcon, rowInset } from './file-tree-rows';

interface NamingRowProps {
  onCancel(): void;
  onCommit(name: string): void;
  /** Why the typed name cannot be used yet, or null. */
  problem: string | null;
}

export interface DraftNameRowProps extends NamingRowProps {
  depth: number;
  entryKind: WorkspaceEntry['kind'];
  /** Folder-relative parent, empty at the folder root. */
  parentPath: string;
}

export function DraftNameRow({
  depth,
  entryKind,
  onCancel,
  onCommit,
  parentPath,
  problem,
}: DraftNameRowProps) {
  return (
    <FileTreeNameRow
      icon={entryKind === 'folder' ? Folder : FileText}
      initialValue=""
      label={`New ${entryKind} ${parentPath ? `in ${parentPath}` : 'in folder root'}`}
      level={depth}
      onCancel={onCancel}
      onCommit={onCommit}
      placeholder={entryKind === 'folder' ? 'Folder name' : 'File name'}
      problem={problem}
      style={rowInset(depth)}
    />
  );
}

export interface RenameNameRowProps extends NamingRowProps {
  /** Where a double click put the caret; absent when the key opened the row,
   *  which selects the name's stem instead. */
  caretOffset: number | undefined;
  expanded: boolean;
  row: TreeRow;
}

export function RenameNameRow({
  caretOffset,
  expanded,
  onCancel,
  onCommit,
  problem,
  row,
}: RenameNameRowProps) {
  return (
    <FileTreeNameRow
      caretOffset={caretOffset}
      icon={rowIcon(row, expanded)}
      initialValue={row.node.name}
      label={`Rename ${row.node.name}`}
      level={row.depth}
      onCancel={onCancel}
      onCommit={onCommit}
      problem={problem}
      selection={caretOffset === undefined ? nameSelection(row) : undefined}
      style={rowInset(row.depth)}
    />
  );
}
