import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vite-plus/test';

import { useWorkspaceSession, type WorkspaceListing } from '@/features/workspace/public';
import { createWorkspaceRuntime } from '@/features/workspace/test-support';
import { pendingSourceApi } from '@/test/fakes/documents';
import {
  folderSession,
  listing,
  listingFile,
  projectApi,
  RESEARCH_FOLDER,
  sessionPersistence,
  workspaceRuntimeOptions,
} from '@/test/fakes/workspace';
import { createTestQueryClient, queryWrapper } from '@/test/query';

import { useDocumentWorkspace } from './use-document-workspace';

const restored = folderSession({
  activeTabId: 'restored-tab',
  tabs: [{ id: 'restored-tab', path: 'plan.md' }],
});

describe('document workspace composition', () => {
  it.each([
    { name: 'root landing page', files: ['index.html'], opens: true },
    { name: 'nested landing page', files: ['site/index.html'], opens: false },
    { name: 'empty project', files: [], opens: false },
    { name: 'unreadable landing page', files: ['index.html'], opens: false, unreadable: true },
    { name: 'navigation before listing', files: ['index.html'], opens: false, navigate: true },
  ])('chooses the initial preview once: $name', async ({ files, opens, unreadable, navigate }) => {
    const workspace = createWorkspaceRuntime(workspaceRuntimeOptions());
    const persistence = sessionPersistence();
    const project = projectApi();
    const api = pendingSourceApi();
    let nextId = 0;
    const createId = () => `tab-${++nextId}`;
    const initialListing = listing(
      files.map((path) =>
        listingFile({
          path,
          format: 'html',
          availability: unreadable ? 'unreadable' : 'available',
        }),
      ),
    );
    const { result, rerender } = renderHook(
      ({ currentListing }: { currentListing: WorkspaceListing | undefined }) => {
        const session = useWorkspaceSession(project, persistence);
        return useDocumentWorkspace(
          session.status.kind === 'ready' ? workspace : null,
          session,
          currentListing,
          api,
          createId,
        );
      },
      {
        initialProps: { currentListing: undefined as WorkspaceListing | undefined },
        wrapper: queryWrapper(createTestQueryClient()),
      },
    );
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current?.activeSource()).toBeNull();
    if (navigate) {
      // Even closing a manually chosen file before the listing arrives must
      // not let the delayed default take over the reader's empty workspace.
      await act(async () => {
        await result.current?.open({ folderPath: workspace.scope.folder.path, path: 'plan.md' });
        await result.current?.closeActive();
      });
    }
    rerender({ currentListing: initialListing });
    await waitFor(() => expect(result.current?.store.getState().tabs).toHaveLength(opens ? 1 : 0));
    expect(result.current?.activeSource()).toEqual(
      opens ? { folderPath: workspace.scope.folder.path, path: 'index.html' } : null,
    );
    expect(result.current?.store.getState().tabs[0]?.preview).toBe(opens ? true : undefined);
    await act(async () => {
      await result.current?.closeActive();
    });
    // A refresh or newly added index is not another project entry.
    rerender({ currentListing: listing([listingFile({ path: 'index.html', format: 'html' })]) });
    await act(async () => undefined);
    expect(result.current?.activeSource()).toBeNull();
    workspace.dispose();
  });

  it('hydrates document identities, records tab changes, and disposes with the folder scope', async () => {
    const persistence = sessionPersistence({
      load: async () => ({
        activeFolderPath: RESEARCH_FOLDER.path,
        folders: [restored],
        shell: { agentPaneWidth: 576, sidebarOpen: true, sidebarWidth: 300 },
        version: 1,
      }),
    });
    const save = vi.mocked(persistence.save);
    const workspace = createWorkspaceRuntime(
      workspaceRuntimeOptions({ folder: RESEARCH_FOLDER, generation: 2 }),
    );
    let nextId = 0;
    const createId = () => `new-tab-${++nextId}`;
    const api = pendingSourceApi();
    const project = projectApi();

    // The session is reached through the app's own wiring, so the tabs this
    // hook records land in the same snapshot the running window would save.
    const { result, rerender } = renderHook(
      ({ currentWorkspace }) => {
        const session = useWorkspaceSession(project, persistence);
        // The shell only mounts a workspace once the session has settled;
        // the tabs runtime is built from whatever it restored.
        const live = session.status.kind === 'ready' ? currentWorkspace : null;
        return {
          documents: useDocumentWorkspace(
            live,
            session,
            listing([listingFile({ path: 'index.html', format: 'html' })]),
            api,
            createId,
          ),
          session,
        };
      },
      {
        initialProps: { currentWorkspace: workspace as typeof workspace | null },
        wrapper: queryWrapper(createTestQueryClient()),
      },
    );

    await waitFor(() =>
      expect(result.current.documents?.activeSource()).toEqual({
        folderPath: RESEARCH_FOLDER.path,
        path: 'plan.md',
      }),
    );
    const restoredDocument = result.current.documents?.getDocument('restored-tab');
    await act(async () => {
      await result.current.documents?.open({
        folderPath: RESEARCH_FOLDER.path,
        path: 'other.md',
      });
    });
    await act(async () => result.current.session.runtime.flush());

    expect(save.mock.calls.at(-1)?.[0].folders[0]?.tabs).toEqual([
      { id: 'restored-tab', path: 'plan.md' },
      { id: 'new-tab-1', path: 'other.md' },
    ]);

    rerender({ currentWorkspace: null });
    expect(restoredDocument?.signal.aborted).toBe(true);
  });
});
