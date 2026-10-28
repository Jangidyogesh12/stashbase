import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vite-plus/test';

import type { UploadPort, UploadResult } from '@/features/workspace/application/ports';
import { createWorkspaceRuntime } from '@/features/workspace/application/runtime';
import { fireDrag } from '@/test/dom';
import { filesApi, listing, listingFile, workspaceRuntimeOptions } from '@/test/fakes/workspace';
import { withQueryClient } from '@/test/query';

import { FileImport } from './file-import';
import { FileTree } from './file-tree';

afterEach(cleanup);

it('offers import in the tree menu and shows progress only while importing', async () => {
  const runtime = createWorkspaceRuntime(workspaceRuntimeOptions());
  let finish!: (result: UploadResult) => void;
  const upload = vi.fn<UploadPort['upload']>(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const { client } = withQueryClient(
    <FileImport api={{ upload }} runtime={runtime}>
      {(importFiles) => (
        <FileTree
          api={filesApi({
            load: vi.fn(async () => listing([listingFile({ path: 'existing.md' })])),
          })}
          importFiles={importFiles}
          revealLabel="Show in file manager"
          runtime={runtime}
        />
      )}
    </FileImport>,
  );
  await screen.findByRole('treeitem', { name: 'existing.md' });
  expect(screen.queryByText('Import files…')).toBeNull();
  expect(screen.queryByText('Importing…')).toBeNull();

  const user = userEvent.setup();
  const input = screen.getByLabelText('Choose files to import');
  const choose = vi.spyOn(input, 'click');
  fireEvent.contextMenu(screen.getByRole('tree', { name: 'Files' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Import files…' }));
  expect(choose).toHaveBeenCalledOnce();
  const file = new File(['draft'], 'draft.md');
  fireEvent.change(input, { target: { files: [file] } });
  expect(await screen.findByText('Importing…')).not.toBeNull();
  expect(upload).toHaveBeenCalledWith(
    runtime.scope.folder.path,
    [{ blob: file, name: 'draft.md' }],
    runtime.signal,
    '',
  );
  await act(async () => finish({ paths: ['draft.md'], refused: [] }));
  expect(screen.queryByText('Importing…')).toBeNull();
  runtime.dispose();
  client.clear();
});

/** A desktop drag as a browser presents it: the files, under the 'Files' type
 *  happy-dom does not list, with entries that say whether each is a folder. */
function desktopDrag(files: readonly File[], directory = false): DataTransfer {
  const dataTransfer = new DataTransfer();
  for (const file of files) dataTransfer.items.add(file);
  dataTransfer.setData('Files', '');
  for (const item of Array.from(dataTransfer.items)) {
    Object.assign(item, { webkitGetAsEntry: () => ({ isDirectory: directory }) });
  }
  return dataTransfer;
}

it('imports desktop files into the folder they are dropped on, and never a dropped folder', async () => {
  const runtime = createWorkspaceRuntime(workspaceRuntimeOptions());
  const upload = vi.fn<UploadPort['upload']>(async () => ({
    paths: ['docs/scan.pdf'],
    refused: [],
  }));
  const { client } = withQueryClient(
    <FileImport api={{ upload }} runtime={runtime}>
      {(importFiles) => (
        <FileTree
          api={filesApi({
            load: vi.fn(async () => listing([listingFile({ path: 'existing.md' })], ['docs'])),
          })}
          importFiles={importFiles}
          revealLabel="Show in file manager"
          runtime={runtime}
        />
      )}
    </FileImport>,
  );
  const docs = await screen.findByRole('treeitem', { name: 'docs' });

  fireDrag(docs, 'dragover', desktopDrag([new File(['a'], 'album')], true));
  fireDrag(docs, 'drop', desktopDrag([new File(['a'], 'album')], true));
  expect((await screen.findByRole('alert')).textContent).toBe(
    'Choose files to import. To use a whole folder, open it as a project.',
  );
  expect(upload).not.toHaveBeenCalled();

  const scan = new File(['scan'], 'scan.pdf');
  fireDrag(docs, 'drop', desktopDrag([scan]));
  expect(upload).toHaveBeenCalledWith(
    runtime.scope.folder.path,
    [{ blob: scan, name: 'scan.pdf' }],
    runtime.signal,
    'docs',
  );
  await waitFor(() => expect(screen.queryByText('Importing…')).toBeNull());
  runtime.dispose();
  client.clear();
});
