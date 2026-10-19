import { useCallback, useMemo } from 'react';
import { useStore } from 'zustand';

import type { WorkspaceRuntime } from '@/features/workspace/application/runtime';
import { buildTree, visibleTree, type WorkspaceListing } from '@/features/workspace/domain/tree';
import {
  expandTreeFolder,
  selectTreePath,
  toggleTreeFolder,
} from '@/features/workspace/domain/workspace';

export function useTree(runtime: WorkspaceRuntime, listing: WorkspaceListing) {
  const expanded = useStore(runtime.store, (state) => state.expanded);
  const selectedPath = useStore(runtime.store, (state) => state.selectedPath);
  const nodes = useMemo(() => buildTree(listing), [listing]);
  const rows = useMemo(() => visibleTree(nodes, expanded), [expanded, nodes]);

  /** A row gesture is scoped work like any other: the scope it was aimed at is
   *  captured when the gesture arrives, and a runtime that has since been
   *  disposed or replaced drops it instead of writing into a retired store. */
  const apply = useCallback(
    (change: Parameters<WorkspaceRuntime['store']['setState']>[0]) => {
      const capturedScope = runtime.capture();
      runtime.accept(capturedScope, () => runtime.store.setState(change));
    },
    [runtime],
  );

  const select = useCallback(
    (path: string) => apply((state) => selectTreePath(state, path)),
    [apply],
  );
  const toggle = useCallback(
    (path: string) => apply((state) => toggleTreeFolder(state, path)),
    [apply],
  );
  const expand = useCallback(
    (path: string) => apply((state) => expandTreeFolder(state, path)),
    [apply],
  );

  return { expand, expanded, rows, select, selectedPath, toggle };
}
