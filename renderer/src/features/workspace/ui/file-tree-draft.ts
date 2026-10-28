/**
 * The create the window asked the tree to make. The request waits in the
 * folder's store until the listing is here to place it beside the selection:
 * a draft is an Untitled made at once, whose new row takes the rename the
 * moment the refreshed listing shows it, so the name is the first thing
 * typed; a folder starts the tree's own name-first create where the
 * selection sits.
 */
import { useEffect } from 'react';
import { useStore } from 'zustand';

import type { WorkspaceRuntime } from '@/features/workspace/application/runtime';
import {
  treeCreationParent,
  untitledDraftName,
  type TreeRow,
  type WorkspaceEntry,
  type WorkspaceListing,
} from '@/features/workspace/domain/tree';
import { clearTreeCreate } from '@/features/workspace/domain/workspace';

import { entryOf } from './file-tree-rows';

export function useTreeDraft({
  listing,
  operations,
  renderedPathKey,
  renderedRows,
  runtime,
  select,
  setRenameCaret,
  setRovingPath,
}: {
  /** The folder's listing, or undefined while it has not arrived. */
  listing: WorkspaceListing | undefined;
  /** The tree's create and rename verbs, and the row waiting for a rename. */
  operations: {
    beginCreate(entryKind: WorkspaceEntry['kind'], parentPath: string): void;
    beginRename(entry: WorkspaceEntry): void;
    consumeRenamePath(): void;
    createDraft(parentPath: string, name: string): Promise<void>;
    createInteractiveNote(parentPath: string): Promise<void>;
    renamePath: string | null;
  };
  renderedPathKey: string;
  renderedRows: readonly TreeRow[];
  runtime: WorkspaceRuntime;
  select(path: string): void;
  setRenameCaret(offset: number | undefined): void;
  setRovingPath(path: string): void;
}): void {
  const {
    beginCreate,
    beginRename,
    consumeRenamePath,
    createDraft,
    createInteractiveNote,
    renamePath,
  } = operations;
  const pendingCreate = useStore(runtime.store, (state) => state.pendingCreate);

  // The request is cleared as it is taken up, so the same ask can be made
  // again once this one has landed.
  useEffect(() => {
    if (!pendingCreate || !listing) return;
    const captured = runtime.capture();
    runtime.accept(captured, () => {
      runtime.store.setState(clearTreeCreate);
      const parent = treeCreationParent(listing, runtime.store.getState().selectedPath);
      if (pendingCreate.kind === 'folder') {
        beginCreate('folder', parent);
        return;
      }
      if (pendingCreate.kind === 'interactive-note') {
        void createInteractiveNote(parent);
        return;
      }
      void createDraft(parent, untitledDraftName(listing, parent));
    });
  }, [beginCreate, createDraft, createInteractiveNote, listing, pendingCreate, runtime]);

  // The row is selected and renamed with the stem of its name ready to be
  // typed over; the rename row focuses itself when it mounts.
  useEffect(() => {
    if (!renamePath) return;
    const row = renderedRows.find((candidate) => candidate.node.path === renamePath);
    if (!row) return;
    consumeRenamePath();
    select(row.node.path);
    setRovingPath(row.node.path);
    setRenameCaret(undefined);
    beginRename(entryOf(row));
  }, [
    beginRename,
    consumeRenamePath,
    renamePath,
    renderedPathKey,
    renderedRows,
    select,
    setRenameCaret,
    setRovingPath,
  ]);
}
