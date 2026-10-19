import type { QueryClient } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { FilesError, type FilesPort } from '@/features/workspace/application/ports';
import {
  createWorkspaceRuntime,
  type WorkspaceRuntime,
} from '@/features/workspace/application/runtime';
import { selectTreePath } from '@/features/workspace/domain/workspace';
import { filesApi, RESEARCH_FOLDER, workspaceRuntimeOptions } from '@/test/fakes/workspace';
import { createTestQueryClient, queryWrapper } from '@/test/query';

import { useFileOperations, type FileOperationsOptions } from './use-file-operations';

const PLAN = { kind: 'file', path: 'docs/plan.md' } as const;
const runtimes: WorkspaceRuntime[] = [];

function folderRuntime(client: QueryClient): WorkspaceRuntime {
  const runtime = createWorkspaceRuntime(
    workspaceRuntimeOptions({
      generation: runtimes.length + 1,
      queries: {
        cancel: () => client.cancelQueries(),
        remove: () => client.removeQueries(),
      },
    }),
  );
  runtimes.push(runtime);
  return runtime;
}

/** Renames answer with the entry's own parent and the new leaf, the way the
 *  server settles a name. */
function operationsApi(overrides: Partial<FilesPort> = {}): FilesPort {
  return filesApi({
    createEntry: vi.fn(async (_folder, _kind, parentPath, name) => ({
      path: parentPath ? `${parentPath}/${name}` : name,
    })),
    renameEntry: vi.fn(async (_folder, entry, name) => ({
      path: entry.path.replace(/[^/]+$/u, name),
    })),
    ...overrides,
  });
}

function harness(api: FilesPort, options: FileOperationsOptions = {}) {
  const client = createTestQueryClient();
  const runtime = folderRuntime(client);
  const hook = renderHook(() => useFileOperations(runtime, api, options), {
    wrapper: queryWrapper(client),
  });
  return { client, hook, runtime };
}

afterEach(() => {
  cleanup();
  for (const runtime of runtimes.splice(0)) runtime.dispose();
});

describe('file operations', () => {
  it('creates an entry, selects it, and asks for its row once the listing settles', async () => {
    const api = operationsApi();
    const onOpenSource = vi.fn();
    const { hook, runtime } = harness(api, { onOpenSource });

    act(() => hook.result.current.beginCreate('file', 'docs'));
    expect(runtime.store.getState().expanded).toEqual({ docs: true });
    await act(() => hook.result.current.commitNaming('plan.md'));

    expect(api.createEntry).toHaveBeenCalledWith(
      RESEARCH_FOLDER.path,
      'file',
      'docs',
      'plan.md',
      expect.any(AbortSignal),
    );
    expect(runtime.store.getState().selectedPath).toBe('docs/plan.md');
    expect(hook.result.current.settledPath).toBe('docs/plan.md');
    // A created file is the reader's to work in, so its tab stays.
    expect(onOpenSource).toHaveBeenCalledWith(
      { folderPath: RESEARCH_FOLDER.path, path: 'docs/plan.md' },
      { keep: true },
    );
    expect(hook.result.current.naming).toBeNull();
    expect(hook.result.current.failure).toBeNull();
  });

  it('coordinates a rename and leaves document rebinding to its owner', async () => {
    const api = operationsApi();
    const onOpenSource = vi.fn();
    const mutateSources = vi.fn(async (_entry, operation: () => Promise<string | null>) => {
      await operation();
      return true;
    });
    const { hook, runtime } = harness(api, { onOpenSource, mutateSources });
    act(() => runtime.store.setState((state) => selectTreePath(state, 'docs/plan.md')));

    act(() => hook.result.current.beginRename(PLAN));
    await act(() => hook.result.current.commitNaming('outline.md'));

    expect(mutateSources).toHaveBeenCalledWith(PLAN, expect.any(Function));
    expect(api.renameEntry).toHaveBeenCalledWith(
      RESEARCH_FOLDER.path,
      PLAN,
      'outline.md',
      expect.any(AbortSignal),
    );
    expect(runtime.store.getState().selectedPath).toBe('docs/outline.md');
    expect(onOpenSource).not.toHaveBeenCalled();
  });

  it('moves a file into another folder, opening it there, and says why a move was refused', async () => {
    const api = operationsApi({
      moveEntry: vi
        .fn<FilesPort['moveEntry']>()
        .mockImplementationOnce(async (_folder, entry, parentPath) => ({
          path: `${parentPath}/${entry.path.split('/').pop()}`,
        }))
        .mockRejectedValueOnce(new FilesError('conflict', 'server sentence')),
    });
    const mutateSources = vi.fn(async (_entry, operation: () => Promise<string | null>) => {
      await operation();
      return true;
    });
    const { hook, runtime } = harness(api, { mutateSources });
    act(() => runtime.store.setState((state) => selectTreePath(state, 'docs/plan.md')));

    // Its own folder is where it already is, so nothing is asked of the server.
    await act(() => hook.result.current.moveEntry(PLAN, 'docs'));
    expect(api.moveEntry).not.toHaveBeenCalled();

    await act(() => hook.result.current.moveEntry(PLAN, 'archive'));
    expect(mutateSources).toHaveBeenCalledWith(PLAN, expect.any(Function));
    expect(api.moveEntry).toHaveBeenCalledWith(
      RESEARCH_FOLDER.path,
      PLAN,
      'archive',
      expect.any(AbortSignal),
    );
    expect(runtime.store.getState()).toMatchObject({
      expanded: { archive: true },
      selectedPath: 'archive/plan.md',
    });
    expect(hook.result.current.settledPath).toBe('archive/plan.md');

    await act(() =>
      hook.result.current.moveEntry({ kind: 'file', path: 'archive/plan.md' }, 'drafts'),
    );
    expect(hook.result.current.failure).toEqual({
      message: 'That folder already has an item with this name.',
      tone: 'input',
    });
    expect(runtime.store.getState().selectedPath).toBe('archive/plan.md');
  });

  it('creates a draft with the name it was handed, opens it at once, and hands its row a rename', async () => {
    const api = operationsApi();
    const onOpenSource = vi.fn();
    const { hook, runtime } = harness(api, { onOpenSource });

    await act(() => hook.result.current.createDraft('docs', 'Untitled.md'));

    expect(api.createEntry).toHaveBeenCalledWith(
      RESEARCH_FOLDER.path,
      'file',
      'docs',
      'Untitled.md',
      expect.any(AbortSignal),
    );
    expect(onOpenSource).toHaveBeenCalledWith(
      { folderPath: RESEARCH_FOLDER.path, path: 'docs/Untitled.md' },
      { keep: true },
    );
    expect(runtime.store.getState()).toMatchObject({
      expanded: { docs: true },
      selectedPath: 'docs/Untitled.md',
    });
    // The row is handed a rename rather than plain focus, so the name is the
    // first thing typed.
    expect(hook.result.current.renamePath).toBe('docs/Untitled.md');
    expect(hook.result.current.settledPath).toBeNull();
    expect(hook.result.current.failure).toBeNull();
    act(() => hook.result.current.consumeRenamePath());
    expect(hook.result.current.renamePath).toBeNull();
  });

  it('keeps an entry when its open document cannot be saved, and deletes when it can', async () => {
    const api = operationsApi();
    const mutateSources = vi
      .fn<NonNullable<FileOperationsOptions['mutateSources']>>()
      .mockResolvedValueOnce(false)
      .mockImplementationOnce(async (_entry, operation) => {
        await operation();
        return true;
      });
    const { hook, runtime } = harness(api, { mutateSources });
    act(() => runtime.store.setState((state) => selectTreePath(state, 'docs/plan.md')));

    act(() => hook.result.current.requestDelete(PLAN));
    await act(() => hook.result.current.confirmDelete());
    expect(api.deleteEntry).not.toHaveBeenCalled();
    expect(hook.result.current.failure).toEqual({
      message: 'An open document could not be saved, so nothing was changed.',
      tone: 'input',
    });
    expect(hook.result.current.deleting).toEqual(PLAN);

    await act(() => hook.result.current.confirmDelete());
    expect(api.deleteEntry).toHaveBeenCalledWith(
      RESEARCH_FOLDER.path,
      PLAN,
      expect.any(AbortSignal),
    );
    expect(hook.result.current.deleting).toBeNull();
    // Selection left with the entry, and focus returns to its parent folder.
    expect(runtime.store.getState().selectedPath).toBeNull();
    expect(hook.result.current.settledPath).toBe('docs');
  });

  it('explains a refused name by its kind and returns focus to where it came from', async () => {
    const api = operationsApi({
      createEntry: vi.fn(async () => {
        throw new FilesError('conflict', 'server sentence');
      }),
    });
    const { hook } = harness(api);

    act(() => hook.result.current.beginCreate('file', 'docs'));
    await act(() => hook.result.current.commitNaming('plan.md'));

    expect(hook.result.current.failure).toEqual({
      message: 'Something with that name already exists.',
      tone: 'input',
    });
    expect(hook.result.current.settledPath).toBe('docs');

    act(() => hook.result.current.consumeSettledPath());
    expect(hook.result.current.settledPath).toBeNull();
  });

  it('refuses a name the wire would reject without asking the server', async () => {
    const api = operationsApi();
    const { hook } = harness(api);

    act(() => hook.result.current.beginCreate('file', ''));
    await act(() => hook.result.current.commitNaming('a/b'));

    expect(api.createEntry).not.toHaveBeenCalled();
    expect(hook.result.current.failure).toEqual({
      message: 'A name cannot contain slashes.',
      tone: 'input',
    });
    expect(hook.result.current.naming).not.toBeNull();
  });

  it('drops a mutation that settles after its folder scope is gone', async () => {
    let settle: ((created: { path: string }) => void) | undefined;
    const api = operationsApi({
      createEntry: vi.fn(
        () =>
          new Promise<{ path: string }>((resolve) => {
            settle = resolve;
          }),
      ),
    });
    const onOpenSource = vi.fn();
    const { client, hook, runtime } = harness(api, { onOpenSource });
    const invalidate = vi.spyOn(client, 'invalidateQueries');

    act(() => hook.result.current.beginCreate('file', 'docs'));
    const commit = hook.result.current.commitNaming('plan.md');
    await waitFor(() => expect(settle).toBeTypeOf('function'));

    // The window moved to another folder: this runtime is disposed and a new
    // generation owns the tree before the create comes back.
    act(() => runtime.dispose());
    await act(async () => {
      settle?.({ path: 'docs/plan.md' });
      await commit;
    });

    expect(runtime.store.getState().selectedPath).toBeNull();
    expect(hook.result.current.settledPath).toBeNull();
    expect(onOpenSource).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
  });
});
