import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import { DependencyProvider } from '@/app/composition/dependency-context';
import {
  createDocumentTabsRuntime,
  type DocumentAdapters,
  type DocumentTabsRuntime,
} from '@/features/documents/public';
import type { WorkspaceAdapters, WorkspaceRuntime } from '@/features/workspace/public';
import { createWorkspaceRuntime } from '@/features/workspace/test-support';
import { appDependencies } from '@/test/fakes/app';
import { createTestQueryClient } from '@/test/query';

import { WorkspaceQuickOpen } from './workspace-quick-open';

let documents: DocumentTabsRuntime;
let workspace: WorkspaceRuntime;
let getAnimationsDescriptor: PropertyDescriptor | undefined;

beforeEach(() => {
  getAnimationsDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'getAnimations');
  Object.defineProperty(Element.prototype, 'getAnimations', {
    configurable: true,
    value: vi.fn(() => []),
  });
});

afterEach(() => {
  cleanup();
  documents?.dispose();
  workspace?.dispose();
  if (getAnimationsDescriptor) {
    Object.defineProperty(Element.prototype, 'getAnimations', getAnimationsDescriptor);
  } else {
    Reflect.deleteProperty(Element.prototype, 'getAnimations');
  }
});

describe('workspace Quick Open composition', () => {
  it('surfaces a hidden entry the listing carries, and drops it when the listing does not', async () => {
    const queryClient = createTestQueryClient();
    const hiddenFile = {
      availability: 'available' as const,
      format: 'md' as const,
      kind: 'regular' as const,
      path: '.github/workflows/ci.md',
      size: 4,
    };
    let showHidden = true;
    const filesApi: WorkspaceAdapters['files'] = {
      load: vi.fn<WorkspaceAdapters['files']['load']>(async () => ({
        files: showHidden ? [hiddenFile] : [],
        folderName: 'Notes',
        folders: [],
        showHiddenFiles: showHidden,
      })),
      createEntry: vi.fn(),
      createInteractiveNote: vi.fn(),
      deleteEntry: vi.fn(),
      moveEntry: vi.fn(),
      renameEntry: vi.fn(),
      reveal: vi.fn(async () => undefined),
    };
    const sourceApi: DocumentAdapters['source'] = {
      load: vi.fn(() => new Promise<never>(() => undefined)),
      overwrite: vi.fn(),
      save: vi.fn(),
    };
    workspace = createWorkspaceRuntime({
      folder: { name: 'Notes', path: '/project/notes' },
      generation: 1,
      queries: {
        cancel: () => queryClient.cancelQueries(),
        remove: () => queryClient.removeQueries(),
      },
    });
    documents = createDocumentTabsRuntime({
      api: sourceApi,
      createId: () => 'opened-tab',
      createQueries: () => ({
        cancel: vi.fn(async () => undefined),
        remove: vi.fn(),
        replaceSource: vi.fn(),
      }),
      folderPath: '/project/notes',
      generation: 1,
    });

    const base = appDependencies();
    const view = (
      <QueryClientProvider client={queryClient}>
        <DependencyProvider
          dependencies={{
            ...base,
            workspace: {
              ...base.workspace,
              adapters: { ...base.workspace.adapters, files: filesApi },
              revealLabel: 'Show in file manager',
            },
          }}
        >
          <WorkspaceQuickOpen documents={documents} onClose={vi.fn()} open workspace={workspace} />
        </DependencyProvider>
      </QueryClientProvider>
    );
    const { rerender } = render(view);

    // Quick Open reads the same listing the tree does, so the Workbench
    // visibility reaches it without a filter of its own.
    const option = await screen.findByRole('option', { name: /ci\.md/ }, { timeout: 5_000 });
    await userEvent.setup().click(option);
    await waitFor(() =>
      expect(documents.openSources()).toEqual([
        { folderPath: '/project/notes', path: '.github/workflows/ci.md' },
      ]),
    );

    showHidden = false;
    await queryClient.invalidateQueries();
    rerender(view);

    // The row leaves the picker, and the tab opened from it stays put: nothing
    // in the documents runtime reads the listing.
    await waitFor(() => expect(screen.queryByRole('option', { name: /ci\.md/ })).toBeNull());
    expect(documents.openSources()).toEqual([
      { folderPath: '/project/notes', path: '.github/workflows/ci.md' },
    ]);
  });

  it('maps visible files to typed open and reveal actions resolved by app composition', async () => {
    const queryClient = createTestQueryClient();
    const filesApi: WorkspaceAdapters['files'] = {
      load: vi.fn<WorkspaceAdapters['files']['load']>(async () => ({
        files: [
          {
            availability: 'available',
            format: 'generic',
            kind: 'regular',
            path: 'archive.bin',
            size: 4,
          },
          {
            availability: 'available',
            format: 'generic',
            kind: 'symlink',
            path: 'linked.bin',
            size: 0,
          },
        ],
        folderName: 'Notes',
        folders: [],
        showHiddenFiles: false,
      })),
      createEntry: vi.fn(),
      createInteractiveNote: vi.fn(),
      deleteEntry: vi.fn(),
      moveEntry: vi.fn(),
      renameEntry: vi.fn(),
      reveal: vi.fn(async () => undefined),
    };
    const sourceApi: DocumentAdapters['source'] = {
      load: vi.fn(() => new Promise<never>(() => undefined)),
      overwrite: vi.fn(),
      save: vi.fn(),
    };
    workspace = createWorkspaceRuntime({
      folder: { name: 'Notes', path: '/project/notes' },
      generation: 1,
      queries: {
        cancel: () => queryClient.cancelQueries(),
        remove: () => queryClient.removeQueries(),
      },
    });
    documents = createDocumentTabsRuntime({
      api: sourceApi,
      createId: () => 'opened-tab',
      createQueries: () => ({
        cancel: vi.fn(async () => undefined),
        remove: vi.fn(),
        replaceSource: vi.fn(),
      }),
      folderPath: '/project/notes',
      generation: 1,
    });

    const base = appDependencies();
    render(
      <QueryClientProvider client={queryClient}>
        <DependencyProvider
          dependencies={{
            ...base,
            workspace: {
              ...base.workspace,
              adapters: { ...base.workspace.adapters, files: filesApi },
              revealLabel: 'Show in file manager',
            },
          }}
        >
          <WorkspaceQuickOpen documents={documents} onClose={vi.fn()} open workspace={workspace} />
        </DependencyProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(filesApi.load).toHaveBeenCalledOnce());
    await userEvent
      .setup()
      .click(
        await screen.findByRole(
          'option',
          { name: 'archive.bin, Notes, excluded from Search and automatic Chat context' },
          { timeout: 5_000 },
        ),
      );

    await waitFor(() =>
      expect(documents.openSources()).toEqual([
        { folderPath: '/project/notes', path: 'archive.bin' },
      ]),
    );

    await userEvent.setup().click(
      await screen.findByRole(
        'option',
        {
          name: 'linked.bin, Notes, excluded from Search and automatic Chat context, Show in file manager',
        },
        { timeout: 5_000 },
      ),
    );

    expect(filesApi.reveal).toHaveBeenCalledWith(
      '/project/notes',
      'linked.bin',
      expect.any(AbortSignal),
    );
    expect(documents.openSources()).toHaveLength(1);
  });
});
