import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vite-plus/test';

import { pressKey } from '@/test/dom';
import { sourceApi, textSource } from '@/test/fakes/documents';

import { registerSourceCleanup, renderSource } from './document-source.harness';

registerSourceCleanup();

describe('document JSON source', () => {
  it('opens strict JSON as a read-only outline and switches to its source in place', async () => {
    const api = sourceApi({
      load: vi.fn(async () =>
        textSource({ content: '{\n  "title": "before",\n  "items": [1, 2]\n}\n', format: 'json' }),
      ),
    });
    const { runtime } = renderSource(api, {
      folderPath: '/project/notes',
      path: 'data.json',
    });

    const outlinePane = await screen.findByRole(
      'region',
      { name: 'JSON outline' },
      { timeout: 5_000 },
    );
    // One view at a time: the source waits behind the view control, mounted.
    const sourcePane = screen.getByLabelText('JSON source');
    expect(sourcePane.hidden).toBe(true);
    const structureTable = screen.getByRole('treegrid', { name: 'JSON values' });
    expect(structureTable.tagName).toBe('TABLE');
    expect(screen.getByRole('columnheader', { name: 'Key' })).not.toBeNull();
    expect(screen.getByRole('columnheader', { name: 'Value' })).not.toBeNull();
    expect(screen.getByRole('columnheader', { name: 'Type' })).not.toBeNull();
    const previewTab = screen.getByRole('tab', { name: 'Preview' });
    const sourceTab = screen.getByRole('tab', { name: 'Source' });
    expect(previewTab.getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByRole('button', { name: /^(Add|Delete)/u })).toBeNull();
    expect(sourcePane.querySelector('.cm-editor')).not.toBeNull(); // dom-contract: CodeMirror internals
    expect(screen.getByRole('row', { name: /^title/u }).textContent).not.toContain('"before"');

    const initialTreeTabStop = within(structureTable).getByRole('row', { selected: true });
    expect(initialTreeTabStop.textContent).toContain('Root');
    pressKey(initialTreeTabStop, 'ArrowDown');
    expect(screen.getByRole('row', { name: /^title/u }).getAttribute('aria-selected')).toBe('true');

    await waitFor(() => expect(runtime.navigation.store.getState().find.available).toBe(true));
    act(() => runtime.navigation.setFindQuery('before'));
    await waitFor(() => expect(runtime.navigation.store.getState().find.total).toBe(1));
    expect(runtime.getDocument('tab-1')?.store.getState().jsonSession.selectedPath).toBe('$.title');

    const sourceEditor = sourcePane.querySelector('.cm-editor'); // dom-contract: CodeMirror internals
    fireEvent.click(sourceTab);
    await waitFor(() =>
      expect(runtime.getDocument('tab-1')?.store.getState().jsonSession.viewMode).toBe('source'),
    );
    expect(outlinePane.hidden).toBe(true);
    expect(screen.getByRole('region', { name: 'JSON source' })).toBe(sourcePane);

    fireEvent.click(previewTab);
    await waitFor(() =>
      expect(runtime.getDocument('tab-1')?.store.getState().jsonSession.viewMode).toBe('tree'),
    );
    expect(sourcePane.hidden).toBe(true);
    expect(sourcePane.querySelector('.cm-editor')).toBe(sourceEditor); // dom-contract: CodeMirror internals
    expect(screen.getByRole('region', { name: 'JSON outline' })).toBe(outlinePane);
  });

  it('keeps malformed JSON editable in Source mode with an actionable reason', async () => {
    const api = sourceApi({
      load: vi.fn(async () => textSource({ content: '{"unfinished":', format: 'json' })),
    });
    const { runtime } = renderSource(api, {
      folderPath: '/project/notes',
      path: 'unfinished.json',
    });

    const json = await screen.findByRole('document', { name: 'unfinished.json JSON content' });
    await waitFor(() => expect(json.getAttribute('data-json-active-pane')).toBe('source'));
    expect(screen.queryByRole('region', { name: 'JSON outline' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'Preview' }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('Invalid JSON · line 1, column 15')).not.toBeNull();
    expect(json.querySelector('.cm-editor')).not.toBeNull(); // dom-contract: CodeMirror internals
    await waitFor(() => expect(runtime.navigation.store.getState().find.available).toBe(true));
    act(() => runtime.navigation.setFindQuery('unfinished'));
    await waitFor(() => expect(runtime.navigation.store.getState().find.total).toBe(1));
  });
});
