import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';

import {
  createDocumentQueryScope,
  prepareDocument,
  createDocumentTabsRuntime,
  type DocumentAdapters,
  type DocumentUsageEvent,
  type DocumentTabsRuntime,
} from '@/features/documents/public';
import {
  fileIsRestricted,
  type WorkspaceListing,
  type WorkspaceRuntime,
  type WorkspaceSessionController,
} from '@/features/workspace/public';
import { useScopedRuntime } from '@/shared/runtime/use-scoped-runtime';

export function useDocumentWorkspace(
  workspace: WorkspaceRuntime | null,
  session: Pick<WorkspaceSessionController, 'runtime' | 'status'>,
  listing: WorkspaceListing | undefined,
  sourceApi: DocumentAdapters['source'],
  createId: () => string,
  previewAdapters?: Pick<DocumentAdapters, 'asset' | 'genericPreview' | 'table'>,
  recordUsage?: (event: DocumentUsageEvent) => void,
): DocumentTabsRuntime | null {
  const queryClient = useQueryClient();
  // Only a settled session names a folder to restore tabs from.
  const restoredRef = useRef(
    session.status.kind === 'ready' ? session.status.restoredFolder : null,
  );
  restoredRef.current = session.status.kind === 'ready' ? session.status.restoredFolder : null;
  const sessionRuntime = session.runtime;
  const folderPath = workspace?.scope.folder.path ?? null;
  const generation = workspace?.scope.generation ?? null;

  const create = useCallback(() => {
    // Only ever called for the scope the key below names, so both halves are
    // present; the fallbacks keep that promise typed rather than asserted.
    const path = folderPath ?? '';
    const restoredFolder = restoredRef.current?.folderPath === path ? restoredRef.current : null;
    return createDocumentTabsRuntime({
      api: sourceApi,
      recordUsage,
      ...(previewAdapters
        ? {
            prepare: (scope) =>
              prepareDocument(queryClient, { ...previewAdapters, source: sourceApi }, scope),
          }
        : {}),
      createId,
      createQueries: (scope) => createDocumentQueryScope(queryClient, scope),
      folderPath: path,
      generation: generation ?? 0,
      restored: restoredFolder
        ? {
            activeTabId: restoredFolder.activeTabId,
            tabs: restoredFolder.tabs.map((tab) => ({
              id: tab.id,
              source: { folderPath: path, path: tab.path },
            })),
          }
        : null,
    });
  }, [createId, folderPath, generation, previewAdapters, queryClient, recordUsage, sourceApi]);

  const runtime =
    useScopedRuntime(
      workspace && folderPath && generation ? `${folderPath}\u0000${generation}` : null,
      create,
      (tabs) => tabs.dispose(),
    ) ?? null;

  const initialized = useRef<DocumentTabsRuntime | null>(null);
  useEffect(() => {
    if (!runtime || initialized.current === runtime) return;
    const state = runtime.store.getState();
    // Restored work and navigation begun while the listing loads take priority.
    if (state.tabs.length > 0 || state.openRequest !== null) {
      initialized.current = runtime;
      return;
    }
    if (!listing) return;
    // Decide once per project entry, including when no landing page exists.
    initialized.current = runtime;
    const index = listing.files.find((file) => file.path === 'index.html');
    if (index && !fileIsRestricted(index)) {
      void runtime.open(
        { folderPath: runtime.scope.folderPath, path: index.path },
        { preview: true },
      );
    }
  }, [listing, runtime]);

  useEffect(() => {
    if (!workspace || !runtime) return;
    const record = () => sessionRuntime.recordWorkspace(workspace.toSession(), runtime.toSession());
    record();
    return runtime.subscribe(record);
  }, [runtime, sessionRuntime, workspace]);

  return runtime;
}
