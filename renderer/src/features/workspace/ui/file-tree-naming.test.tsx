import type { QueryClient } from '@tanstack/react-query';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import type { FilesPort } from '@/features/workspace/application/ports';
import {
  createWorkspaceRuntime,
  type WorkspaceRuntime,
} from '@/features/workspace/application/runtime';
import { expectFocused } from '@/test/dom';
import {
  filesApi,
  listing,
  listingFile,
  listingFolder,
  RESEARCH_FOLDER,
  workspaceRuntimeOptions,
} from '@/test/fakes/workspace';
import { createTestQueryClient, withQueryClient } from '@/test/query';

import { FileTree } from './file-tree';

const RESEARCH_LISTING = listing(
  [
    listingFile({ path: 'docs/plan.md', size: 42 }),
    listingFile({ format: 'generic', path: 'archive.zip', size: 7 }),
    listingFile({ format: 'generic', kind: 'symlink', path: 'linked-file', size: 0 }),
  ],
  ['docs', listingFolder({ kind: 'excluded', path: 'vendor' })],
);

const runtimes: WorkspaceRuntime[] = [];

/** One runtime per rendered tree, bound to the client the tree reads through
 *  so disposal cancels exactly those queries. */
function treeRuntime(client: QueryClient): WorkspaceRuntime {
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

function renderTree(
  api: FilesPort,
  onOpenSource: ComponentProps<typeof FileTree>['onOpenSource'],
  mutateSources?: ComponentProps<typeof FileTree>['mutateSources'],
) {
  const client = createTestQueryClient();
  return withQueryClient(
    <FileTree
      api={api}
      onOpenSource={onOpenSource}
      mutateSources={mutateSources}
      revealLabel="Show in file manager"
      runtime={treeRuntime(client)}
    />,
    client,
  );
}

/** The tree drives create and rename through server-settled paths, so those
 *  two ports echo the request the component made. */
function treeApi(): FilesPort {
  return filesApi({
    createEntry: vi.fn(async (_folder, _kind, parentPath, name) => ({
      path: parentPath ? `${parentPath}/${name}` : name,
    })),
    load: vi.fn(async () => RESEARCH_LISTING),
    renameEntry: vi.fn(async (_folder, entry, name) => ({
      path: entry.path.replace(/[^/]+$/u, name),
    })),
  });
}

afterEach(() => {
  cleanup();
  for (const runtime of runtimes.splice(0)) runtime.dispose();
});

describe('file tree naming', () => {
  it('names a new file from the tree space and a new folder from a folder row', async () => {
    const api = treeApi();
    const onOpenSource = vi.fn();
    renderTree(api, onOpenSource);
    const user = userEvent.setup();

    const tree = await screen.findByRole('tree', { name: 'Files' });
    fireEvent.contextMenu(tree, { clientX: 40, clientY: 200 });
    await user.click(await screen.findByRole('menuitem', { name: 'New file' }));
    const draft = await screen.findByRole('textbox', { name: 'New file in folder root' });
    expectFocused(draft);
    await user.keyboard('a/b{Enter}');
    expect(screen.getByRole('alert').textContent).toBe('A name cannot contain slashes.');
    expect(api.createEntry).not.toHaveBeenCalled();
    await user.clear(draft);
    await user.keyboard('Plan{Enter}');
    await waitFor(() =>
      expect(api.createEntry).toHaveBeenCalledWith(
        RESEARCH_FOLDER.path,
        'file',
        '',
        'Plan',
        expect.any(AbortSignal),
      ),
    );
    // A file the tree just made is the reader's to work in, so its tab stays.
    await waitFor(() =>
      expect(onOpenSource).toHaveBeenCalledWith(
        { folderPath: RESEARCH_FOLDER.path, path: 'Plan' },
        { keep: true },
      ),
    );
    expect(screen.queryByRole('textbox')).toBeNull();

    fireEvent.contextMenu(screen.getByRole('treeitem', { name: 'docs' }), {
      clientX: 12,
      clientY: 12,
    });
    await user.click(await screen.findByRole('menuitem', { name: 'New folder' }));
    const folderDraft = await screen.findByRole('textbox', { name: 'New folder in docs' });
    expect(folderDraft.closest('[role="treeitem"]')?.getAttribute('aria-level')).toBe('2');
    expect(screen.getByRole('treeitem', { name: 'docs' }).getAttribute('aria-expanded')).toBe(
      'true',
    );
    await user.keyboard('archive{Enter}');
    await waitFor(() =>
      expect(api.createEntry).toHaveBeenLastCalledWith(
        RESEARCH_FOLDER.path,
        'folder',
        'docs',
        'archive',
        expect.any(AbortSignal),
      ),
    );

    fireEvent.contextMenu(tree, { clientX: 40, clientY: 200 });
    await user.click(await screen.findByRole('menuitem', { name: 'New folder' }));
    await screen.findByRole('textbox', { name: 'New folder in folder root' });
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(api.createEntry).toHaveBeenCalledTimes(2);
  });

  it('renames from F2 with the stem selected and from a double click, coordinating open documents', async () => {
    const api = treeApi();
    const onOpenSource = vi.fn();
    const mutateSources = vi.fn(async (_entry, operation: () => Promise<string | null>) => {
      await operation();
      return true;
    });
    renderTree(api, onOpenSource, mutateSources);
    const user = userEvent.setup();

    const docs = await screen.findByRole('treeitem', { name: 'docs' });
    docs.focus();
    await user.keyboard('{Enter}');
    const plan = await screen.findByRole('treeitem', { name: 'plan.md' });
    plan.focus();
    await user.keyboard('{F2}');
    const field = await screen.findByRole<HTMLInputElement>('textbox', { name: 'Rename plan.md' });
    expect(field.value).toBe('plan.md');
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, 4]);
    await user.keyboard('outline{Enter}');
    await waitFor(() =>
      expect(api.renameEntry).toHaveBeenCalledWith(
        RESEARCH_FOLDER.path,
        { kind: 'file', path: 'docs/plan.md' },
        'outline.md',
        expect.any(AbortSignal),
      ),
    );
    expect(mutateSources).toHaveBeenCalledWith(
      { kind: 'file', path: 'docs/plan.md' },
      expect.any(Function),
    );
    expect(onOpenSource).not.toHaveBeenCalled();

    fireEvent.doubleClick(screen.getByRole('treeitem', { name: 'docs' }));
    const folderField = await screen.findByRole<HTMLInputElement>('textbox', {
      name: 'Rename docs',
    });
    expect(folderField.value).toBe('docs');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(api.renameEntry).toHaveBeenCalledTimes(1);
    expectFocused(screen.getByRole('treeitem', { name: 'docs' }));
  });
});
