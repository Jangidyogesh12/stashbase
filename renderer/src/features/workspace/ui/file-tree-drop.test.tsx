import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import type { FilesPort } from '@/features/workspace/application/ports';
import {
  createWorkspaceRuntime,
  type WorkspaceRuntime,
} from '@/features/workspace/application/runtime';
import { expectFocused, fireDrag } from '@/test/dom';
import {
  filesApi,
  listing,
  listingFile,
  listingFolder,
  RESEARCH_FOLDER,
  workspaceRuntimeOptions,
} from '@/test/fakes/workspace';
import { withQueryClient } from '@/test/query';

import { FileTree } from './file-tree';
import { SPRING_OPEN_MS } from './file-tree-drop';

const PLAN = listingFile({ path: 'docs/plan.md', size: 42 });
const runtimes: WorkspaceRuntime[] = [];

function renderTree(api: FilesPort, importFiles?: ComponentProps<typeof FileTree>['importFiles']) {
  const runtime = createWorkspaceRuntime(workspaceRuntimeOptions());
  runtimes.push(runtime);
  return withQueryClient(
    <FileTree
      api={api}
      importFiles={importFiles}
      onOpenSource={vi.fn()}
      revealLabel="Show in file manager"
      runtime={runtime}
    />,
  );
}

afterEach(() => {
  cleanup();
  for (const runtime of runtimes.splice(0)) runtime.dispose();
});

describe('file tree drop', () => {
  const NOTES = listingFile({ path: 'notes.md' });
  const VENDOR = listingFolder({ kind: 'excluded', path: 'vendor' });

  it('moves a dragged file into the folder it is dropped on, and nowhere it already is', async () => {
    let files = [PLAN, NOTES];
    const api = filesApi({
      load: vi.fn(async () => listing(files, ['docs', 'drafts', VENDOR])),
      moveEntry: vi.fn(async (_folder, entry, parentPath) => {
        const path = `${parentPath}/${entry.path}`;
        files = files.map((file) => (file.path === entry.path ? listingFile({ path }) : file));
        return { path };
      }),
    });
    renderTree(api);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('treeitem', { name: 'docs' }));
    const notes = screen.getByRole('treeitem', { name: 'notes.md' });
    const dataTransfer = new DataTransfer();
    fireDrag(notes, 'dragstart', dataTransfer);

    // Over itself the file is already in that folder, and an excluded folder
    // takes nothing, so neither is a target, and nothing behind takes the drop.
    expect(fireDrag(notes, 'dragover', dataTransfer)).toBe(false);
    expect(dataTransfer.dropEffect).toBe('none');
    fireDrag(
      screen.getByRole('treeitem', { name: 'vendor, restricted, Show in file manager' }),
      'dragover',
      dataTransfer,
    );
    expect(dataTransfer.dropEffect).toBe('none');

    // A file row inside a folder stands for that folder.
    fireDrag(screen.getByRole('treeitem', { name: 'plan.md' }), 'dragover', dataTransfer);
    expect(dataTransfer.dropEffect).toBe('move');
    // Entering a row already answers for it, so a drop right after lands.
    const drafts = screen.getByRole('treeitem', { name: 'drafts' });
    fireDrag(drafts, 'dragenter', dataTransfer);
    expect(dataTransfer.dropEffect).toBe('move');
    fireDrag(drafts, 'drop', dataTransfer);
    fireDrag(notes, 'dragend', dataTransfer);

    expect(api.moveEntry).toHaveBeenCalledOnce();
    expect(api.moveEntry).toHaveBeenCalledWith(
      RESEARCH_FOLDER.path,
      { kind: 'file', path: 'notes.md' },
      'drafts',
      expect.any(AbortSignal),
    );
    // The destination opens, and the moved row takes focus where it landed.
    await waitFor(() =>
      expect(screen.getByRole('treeitem', { name: 'notes.md' }).getAttribute('aria-level')).toBe(
        '2',
      ),
    );
    expect(drafts.getAttribute('aria-expanded')).toBe('true');
    await waitFor(() => expectFocused(screen.getByRole('treeitem', { name: 'notes.md' })));
  });

  it('moves a folder with its open branches, and never into itself', async () => {
    let files = [PLAN, listingFile({ path: 'docs/drafts/idea.md' })];
    let folders = ['docs', 'docs/drafts', 'book'];
    const api = filesApi({
      load: vi.fn(async () => listing(files, folders)),
      moveEntry: vi.fn(async (_folder, entry, parentPath) => {
        const path = `${parentPath}/${entry.path}`;
        const move = (item: string) =>
          item === entry.path || item.startsWith(`${entry.path}/`)
            ? `${path}${item.slice(entry.path.length)}`
            : item;
        files = files.map((file) => listingFile({ path: move(file.path) }));
        folders = folders.map(move);
        return { path };
      }),
    });
    renderTree(api);
    const user = userEvent.setup();
    const docs = await screen.findByRole('treeitem', { name: 'docs' });
    await user.click(docs);
    await user.click(screen.getByRole('treeitem', { name: 'drafts' }));
    const dataTransfer = new DataTransfer();
    fireDrag(docs, 'dragstart', dataTransfer);

    // Onto itself, or onto anything inside it, the folder would land in itself.
    fireDrag(docs, 'dragenter', dataTransfer);
    expect(dataTransfer.dropEffect).toBe('none');
    fireDrag(screen.getByRole('treeitem', { name: 'idea.md' }), 'dragover', dataTransfer);
    expect(dataTransfer.dropEffect).toBe('none');
    fireDrag(screen.getByRole('treeitem', { name: 'drafts' }), 'drop', dataTransfer);
    expect(api.moveEntry).not.toHaveBeenCalled();

    const book = screen.getByRole('treeitem', { name: 'book' });
    fireDrag(book, 'dragenter', dataTransfer);
    expect(dataTransfer.dropEffect).toBe('move');
    fireDrag(book, 'drop', dataTransfer);
    fireDrag(docs, 'dragend', dataTransfer);

    expect(api.moveEntry).toHaveBeenCalledWith(
      RESEARCH_FOLDER.path,
      { kind: 'folder', path: 'docs' },
      'book',
      expect.any(AbortSignal),
    );
    // The moved folder lands open under book, its open branch still open.
    await waitFor(() =>
      expect(screen.getByRole('treeitem', { name: 'docs' }).getAttribute('aria-level')).toBe('2'),
    );
    expect(screen.getByRole('treeitem', { name: 'docs' }).getAttribute('aria-expanded')).toBe(
      'true',
    );
    expect(screen.getByRole('treeitem', { name: 'idea.md' }).getAttribute('aria-level')).toBe('4');
  });

  it('opens a closed folder a drag rests on', async () => {
    renderTree(filesApi({ load: vi.fn(async () => listing([PLAN, NOTES], ['docs'])) }));
    const docs = await screen.findByRole('treeitem', { name: 'docs' });
    const dataTransfer = new DataTransfer();
    fireDrag(screen.getByRole('treeitem', { name: 'notes.md' }), 'dragstart', dataTransfer);
    fireDrag(docs, 'dragover', dataTransfer);

    expect(docs.getAttribute('aria-expanded')).toBe('false');
    await waitFor(() => expect(docs.getAttribute('aria-expanded')).toBe('true'), {
      timeout: SPRING_OPEN_MS * 3,
    });
  });

  it('imports desktop files into the folder they are dropped on', async () => {
    const drop = vi.fn();
    renderTree(filesApi({ load: vi.fn(async () => listing([NOTES], ['docs'])) }), {
      disabled: false,
      drop,
      run: vi.fn(),
    });
    const docs = await screen.findByRole('treeitem', { name: 'docs' });
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(new File(['scan'], 'scan.pdf'));
    // A browser names a desktop drag by the 'Files' type; happy-dom lists
    // each item's own MIME type instead.
    dataTransfer.setData('Files', '');

    fireDrag(docs, 'dragover', dataTransfer);
    expect(dataTransfer.dropEffect).toBe('copy');
    fireDrag(docs, 'drop', dataTransfer);
    expect(drop).toHaveBeenCalledWith(dataTransfer, 'docs');
    expect(docs.getAttribute('aria-expanded')).toBe('true');

    // A root-level file row stands for the root.
    fireDrag(screen.getByRole('treeitem', { name: 'notes.md' }), 'drop', dataTransfer);
    expect(drop).toHaveBeenLastCalledWith(dataTransfer, '');
  });
});
