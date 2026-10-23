import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vite-plus/test';

import { createDocumentQueryScope } from '@/features/documents/application/queries';
import { createDocumentTabsRuntime } from '@/features/documents/application/tabs-runtime';
import {
  assetApi,
  documentTabsRuntimeOptions,
  docxPreviewApi,
  genericPreviewApi,
  sourceApi,
  tableApi,
  textSource,
} from '@/test/fakes/documents';
import { createTestQueryClient, queryWrapper } from '@/test/query';

import { DocumentWorkspace } from './workspace';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it('retains a covered workspace without polling and refreshes when it returns', async () => {
  const api = sourceApi({ load: vi.fn(async () => textSource({ format: 'txt' })) });
  const client = createTestQueryClient();
  const runtime = createDocumentTabsRuntime(
    documentTabsRuntimeOptions({
      api,
      createQueries: (scope) => createDocumentQueryScope(client, scope),
      restored: {
        activeTabId: 'plan',
        tabs: [{ id: 'plan', source: { folderPath: '/project/notes', path: 'plan.txt' } }],
      },
    }),
  );
  function Workspace({ active }: { active: boolean }) {
    return (
      <DocumentWorkspace
        active={active}
        assetApi={assetApi()}
        docxPreviewApi={docxPreviewApi()}
        genericPreviewApi={genericPreviewApi()}
        tableApi={tableApi()}
        onReveal={async () => undefined}
        revealLabel="Show in file manager"
        runtime={runtime}
        sourceApi={api}
      />
    );
  }
  const view = render(<Workspace active />, { wrapper: queryWrapper(client) });
  try {
    const editor = await screen.findByLabelText('plan.txt source');
    vi.useFakeTimers();
    view.rerender(<Workspace active={false} />);
    vi.mocked(api.load)
      .mockClear()
      .mockResolvedValue(textSource({ content: 'while hidden', format: 'txt', version: 'v2' }));
    act(() => window.dispatchEvent(new Event('focus')));
    await act(async () => vi.advanceTimersByTimeAsync(4_001));
    expect(api.load).not.toHaveBeenCalled();
    expect(editor.textContent).toBe('# Plan');
    vi.useRealTimers();
    view.rerender(<Workspace active />);
    await waitFor(() => expect(editor.textContent).toBe('while hidden'));
    expect(screen.getByLabelText('plan.txt source')).toBe(editor);
  } finally {
    view.unmount();
    runtime.dispose();
    client.clear();
  }
});
