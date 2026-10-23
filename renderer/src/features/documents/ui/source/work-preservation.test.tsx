import { undo, undoDepth } from '@codemirror/commands';
import { EditorView } from '@codemirror/view';
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vite-plus/test';

import { DocumentSaveError, DocumentSourceError } from '@/features/documents/application/ports';
import { createDocumentQueryScope } from '@/features/documents/application/queries';
import { createDocumentTabsRuntime } from '@/features/documents/application/tabs-runtime';
import { useDocumentCommands } from '@/features/documents/hooks/use-document-commands';
import { useNewTab } from '@/features/documents/hooks/use-new-tab';
import { AssetSurface } from '@/features/documents/ui/source/asset';
import { DocumentWorkspace } from '@/features/documents/ui/workspace/workspace';
import {
  assetApi,
  documentTabsRuntimeOptions,
  docxPreviewApi,
  genericPreviewApi,
  sourceApi,
  tableApi,
  textSource,
} from '@/test/fakes/documents';
import { createTestQueryClient, withQueryClient } from '@/test/query';

const disposers: Array<() => void> = [];
afterEach(() => {
  cleanup();
  disposers.splice(0).forEach((dispose) => dispose());
});
const folderPath = '/project/notes';
function tabs(api = sourceApi(), paths = ['a.txt', 'b.txt']) {
  const client = createTestQueryClient();
  const runtime = createDocumentTabsRuntime(
    documentTabsRuntimeOptions({
      api,
      createQueries: (scope) => createDocumentQueryScope(client, scope),
      restored: {
        activeTabId: 'a',
        tabs: paths.map((path, i) => ({ id: i === 0 ? 'a' : 'b', source: { folderPath, path } })),
      },
    }),
  );
  disposers.push(() => {
    runtime.dispose();
    client.clear();
  });
  return { runtime, client };
}
function editor(label: string) {
  const element = screen.getByLabelText(label).closest<HTMLElement>('.cm-editor');
  const view = element && EditorView.findFromDOM(element);
  if (!view) throw new Error('Missing editor');
  return view;
}

it('keeps undo history when returning to a text tab', async () => {
  const files = new Map([
    ['a.txt', 'before'],
    ['b.txt', 'reference'],
  ]);
  const api = sourceApi({
    load: vi.fn(async (source) =>
      textSource({ content: files.get(source.path) ?? '', format: 'txt' }),
    ),
    save: vi.fn(async (source, input) => {
      files.set(source.path, input.content);
      return textSource({ content: input.content, format: 'txt' });
    }),
  });
  const { runtime, client } = tabs(api);
  withQueryClient(
    <DocumentWorkspace
      runtime={runtime}
      sourceApi={api}
      assetApi={assetApi()}
      docxPreviewApi={docxPreviewApi()}
      genericPreviewApi={genericPreviewApi()}
      tableApi={tableApi()}
      onReveal={async () => {}}
      revealLabel="Reveal"
    />,
    client,
  );
  await screen.findByLabelText('a.txt source');
  const before = editor('a.txt source');
  act(() =>
    before.dispatch({ changes: { from: 0, to: before.state.doc.length, insert: 'my edit' } }),
  );
  expect(undoDepth(before.state)).toBe(1);
  await act(async () => {
    await runtime.activate('b');
  });
  await screen.findByLabelText('b.txt source');
  await act(async () => {
    await runtime.activate('a');
  });
  await screen.findByLabelText('a.txt source');
  const returned = editor('a.txt source');
  expect(returned.state.doc.toString()).toBe('my edit');
  expect(undoDepth(returned.state)).toBe(1);
  act(() => {
    expect(undo(returned)).toBe(true);
  });
  expect(returned.state.doc.toString()).toBe('before');
});

it('keeps an existing asset preview on refresh failure', async () => {
  const { runtime, client } = tabs(sourceApi(), ['a.pdf']);
  const api = assetApi();
  const document = runtime.getDocument('a');
  if (!document) throw new Error('Missing document.');
  withQueryClient(
    <AssetSurface
      active
      api={api}
      name="a.pdf"
      runtime={document}
      status={({ error }) => <p>{error ? 'Load failed' : 'Loading'}</p>}
    >
      {() => <p>Existing preview</p>}
    </AssetSurface>,
    client,
  );
  await screen.findByText('Existing preview');
  vi.mocked(api.load).mockRejectedValue(new Error('offline'));
  await act(async () => {
    await client.invalidateQueries();
  });
  await screen.findByText('Refresh failed. Showing the last loaded preview.');
  expect(screen.getByText('Existing preview')).not.toBeNull();
});

it('closes only New tab when it owns the visible surface', async () => {
  const { runtime, client } = tabs();
  function Commands() {
    const tab = useNewTab(runtime);
    useDocumentCommands(runtime.navigation, runtime, { newTab: tab });
    return <button onClick={tab.add}>{tab.open ? 'New tab selected' : 'Add tab'}</button>;
  }
  withQueryClient(<Commands />, client);
  fireEvent.click(screen.getByText('Add tab'));
  expect(screen.getByText('New tab selected')).not.toBeNull();
  fireEvent.keyDown(document, { key: 'w', metaKey: true });
  await screen.findByText('Add tab');
  expect(runtime.getDocument('a')).not.toBeNull();
  expect(runtime.getDocument('b')).not.toBeNull();
  fireEvent.click(screen.getByText('Add tab'));
  await act(async () => {
    await runtime.open({ folderPath, path: 'a.txt' });
  });
  expect(screen.getByText('Add tab')).not.toBeNull();
});

it('offers restore, and asks before closing, a draft whose source file is gone', async () => {
  const api = sourceApi({
    load: vi
      .fn()
      .mockResolvedValueOnce(textSource({ content: 'before', format: 'txt' }))
      .mockRejectedValue(new DocumentSourceError('missing', 'gone')),
    save: vi.fn().mockRejectedValue(new DocumentSaveError('conflict', 'changed')),
  });
  const { runtime, client } = tabs(api, ['a.txt']);
  withQueryClient(
    <DocumentWorkspace
      runtime={runtime}
      sourceApi={api}
      assetApi={assetApi()}
      docxPreviewApi={docxPreviewApi()}
      genericPreviewApi={genericPreviewApi()}
      tableApi={tableApi()}
      onReveal={async () => {}}
      revealLabel="Reveal"
    />,
    client,
  );
  await screen.findByLabelText('a.txt source');
  const view = editor('a.txt source');
  act(() => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'my edit' } }));
  await act(async () => {
    await runtime.getDocument('a')?.save(api);
  });
  await screen.findByText('The source file is gone, so this draft is not being saved.');

  // Closing asks, and cancelling keeps both the tab and the draft.
  await act(async () => {
    await runtime.close('a');
  });
  const question = await screen.findByText('Close without saving?');
  // The question has to name the file it is about.
  const panel = question.closest('[role=dialog], [role=alertdialog]');
  expect(panel?.textContent).toContain('a.txt');
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  });
  expect(runtime.store.getState().tabs).toHaveLength(1);

  // The document's own action writes the draft back to its old path.
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Restore file' }));
  });
  expect(api.overwrite).toHaveBeenCalledWith(
    { folderPath, path: 'a.txt' },
    { content: 'my edit' },
    expect.anything(),
  );
  expect(runtime.getDocument('a')?.store.getState().editor?.save.kind).toBe('saved');
});
