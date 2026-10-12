import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vite-plus/test';

import type { DocumentSourcePort } from '@/features/documents/application/ports';
import { pressKey } from '@/test/dom';
import { sourceApi, textSource } from '@/test/fakes/documents';

import { registerSourceCleanup, renderSource } from './document-source.harness';

registerSourceCleanup();

describe('document JSON source', () => {
  it('opens strict JSON as a source-preserving tree and saves a structural edit', async () => {
    const original = '\uFEFF{\r\n  "title" : "before",\r\n  "items": [1, 2]\r\n}\r\n';
    const api = sourceApi({
      load: vi.fn(async () => textSource({ content: original, format: 'json' })),
      save: vi.fn<DocumentSourcePort['save']>(async (_source, input) =>
        textSource({
          content: input.content.replace(/\n/gu, '\r\n'),
          format: 'json',
          version: 'v2',
        }),
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
    const sourcePane = screen.getByRole('region', { name: 'JSON source' });
    const structureTable = screen.getByRole('treegrid', { name: 'JSON values' });
    expect(structureTable.tagName).toBe('TABLE');
    expect(screen.getByRole('columnheader', { name: 'Key' })).not.toBeNull();
    expect(screen.getByRole('columnheader', { name: 'Value' })).not.toBeNull();
    expect(screen.getByRole('columnheader', { name: 'Type' })).not.toBeNull();
    expect(screen.getByText('Preview')).not.toBeNull();
    expect(screen.getByText('Source')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Selected value actions' })).toBeNull();
    expect(sourcePane.querySelector('.cm-editor')).not.toBeNull(); // dom-contract: CodeMirror internals
    expect(screen.queryByPlaceholderText('Search tree')).toBeNull();
    expect(screen.getByRole('row', { name: /^title/u }).textContent).not.toContain('"before"');

    const initialTreeTabStop = within(structureTable).getByRole('row', { selected: true });
    expect(initialTreeTabStop.textContent).toContain('Root');
    pressKey(initialTreeTabStop, 'ArrowDown');
    expect(screen.getByRole('row', { name: /^title/u }).getAttribute('aria-selected')).toBe('true');

    await waitFor(() => expect(runtime.navigation.store.getState().find.available).toBe(true));
    act(() => runtime.navigation.setFindQuery('before'));
    await waitFor(() => expect(runtime.navigation.store.getState().find.total).toBe(1));
    expect(runtime.getDocument('tab-1')?.store.getState().jsonSession.selectedPath).toBe('$.title');

    const sourceContent = sourcePane.querySelector<HTMLElement>('.cm-content'); // dom-contract: CodeMirror internals
    expect(sourceContent).not.toBeNull();
    if (sourceContent) fireEvent.focus(sourceContent);
    await waitFor(() =>
      expect(runtime.getDocument('tab-1')?.store.getState().jsonSession.viewMode).toBe('source'),
    );
    expect(screen.getByRole('region', { name: 'JSON outline' })).toBe(outlinePane);
    expect(screen.getByRole('region', { name: 'JSON source' })).toBe(sourcePane);

    const titleRow = screen.getByRole('row', { name: /^title/u });
    const titleValueCell = within(titleRow).getAllByRole('cell')[1];
    expect(titleValueCell).toBeDefined();
    const ownerDocument = titleValueCell?.ownerDocument;
    expect(ownerDocument).toBeDefined();
    if (!ownerDocument) throw new Error('The value cell must belong to a document.');
    const caretDescriptor = Object.getOwnPropertyDescriptor(
      ownerDocument,
      'caretPositionFromPoint',
    );
    Object.defineProperty(ownerDocument, 'caretPositionFromPoint', {
      configurable: true,
      value: () => ({ offset: 2, offsetNode: titleValueCell?.firstChild }),
    });
    if (titleValueCell) fireEvent.doubleClick(titleValueCell, { clientX: 24, clientY: 12 });
    if (caretDescriptor)
      Object.defineProperty(ownerDocument, 'caretPositionFromPoint', caretDescriptor);
    else Reflect.deleteProperty(ownerDocument, 'caretPositionFromPoint');
    await waitFor(() =>
      expect(runtime.getDocument('tab-1')?.store.getState().jsonSession.viewMode).toBe('tree'),
    );
    expect(screen.getByRole('region', { name: 'JSON outline' })).toBe(outlinePane);
    expect(screen.getByRole('region', { name: 'JSON source' })).toBe(sourcePane);
    const inlineValue = await screen.findByLabelText('JSON value');
    expect(inlineValue.closest('[data-json-inline-editor]')).not.toBeNull();
    expect((inlineValue as HTMLInputElement).value).toBe('before');
    expect((inlineValue as HTMLInputElement).selectionStart).toBe(2);
    expect((inlineValue as HTMLInputElement).selectionEnd).toBe(2);
    fireEvent.change(inlineValue, { target: { value: 'after' } });
    vi.useFakeTimers();
    pressKey(inlineValue, 'Enter');
    expect(screen.queryByLabelText('JSON value')).toBeNull();

    expect(runtime.getDocument('tab-1')?.store.getState().editor).toMatchObject({
      save: { kind: 'dirty' },
      value: '\uFEFF{\n  "title" : "after",\n  "items": [1, 2]\n}\n',
    });
    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(api.save).toHaveBeenCalledWith(
      { folderPath: '/project/notes', path: 'data.json' },
      {
        baseVersion: 'v1',
        content: '\uFEFF{\n  "title" : "after",\n  "items": [1, 2]\n}\n',
      },
      expect.any(AbortSignal),
    );
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
    expect(screen.getByRole('region', { name: 'JSON outline' })).not.toBeNull();
    expect(screen.getByText('Invalid JSON · line 1, column 15')).not.toBeNull();
    expect(json.querySelector('.cm-editor')).not.toBeNull(); // dom-contract: CodeMirror internals
    await waitFor(() => expect(runtime.navigation.store.getState().find.available).toBe(true));
    act(() => runtime.navigation.setFindQuery('unfinished'));
    await waitFor(() => expect(runtime.navigation.store.getState().find.total).toBe(1));
  });

  it('adds and renames object properties in place', async () => {
    const api = sourceApi({
      load: vi.fn(async () => textSource({ content: '{"name":"Ada"}', format: 'json' })),
      save: vi.fn<DocumentSourcePort['save']>(async (_source, input) =>
        textSource({ content: input.content, format: 'json', version: 'v2' }),
      ),
    });
    const { runtime } = renderSource(api, {
      folderPath: '/project/notes',
      path: 'person.json',
    });

    await screen.findByRole('treegrid', { name: 'JSON values' });
    fireEvent.click(screen.getByRole('button', { name: 'Add property' }));
    const key = screen.getByLabelText('New property key');
    const value = screen.getByLabelText('New JSON value');
    const addRow = key.closest('[data-json-inline-editor]');
    expect(addRow).toBe(value.closest('[data-json-inline-editor]'));
    const treeRows = within(screen.getByRole('treegrid')).getAllByRole('row');
    expect(addRow).toBe(treeRows.at(-1));
    fireEvent.change(key, { target: { value: 'count' } });
    fireEvent.change(value, { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add value' }));

    const countRow = await screen.findByRole('row', { name: /^count/u });
    expect(runtime.getDocument('tab-1')?.store.getState().editor?.value).toBe(
      '{"name":"Ada","count":1}',
    );

    fireEvent.click(countRow);
    pressKey(countRow, 'F2');
    const renamedKey = await screen.findByLabelText('Key');
    expect(renamedKey.closest('[data-json-inline-editor]')).not.toBeNull();
    fireEvent.change(renamedKey, { target: { value: 'total' } });
    pressKey(renamedKey, 'Enter');

    expect(runtime.getDocument('tab-1')?.store.getState().editor?.value).toBe(
      '{"name":"Ada","total":1}',
    );

    const totalRow = screen.getByRole('row', { name: /^total/u });
    const deleteTotal = screen.getByRole('button', { name: 'Delete total' });
    expect(totalRow.getAttribute('aria-keyshortcuts')).toBe('Delete');
    fireEvent.click(deleteTotal);
    expect(runtime.getDocument('tab-1')?.store.getState().editor?.value).toBe('{"name":"Ada"}');
  });

  it('adds plain table text as a JSON string without exposing source-mode errors', async () => {
    const api = sourceApi({
      load: vi.fn(async () => textSource({ content: '{"name":"Ada"}', format: 'json' })),
    });
    const { runtime } = renderSource(api, {
      folderPath: '/project/notes',
      path: 'person.json',
    });

    await screen.findByRole('treegrid', { name: 'JSON values' });
    fireEvent.click(screen.getByRole('button', { name: 'Add property' }));
    fireEvent.change(screen.getByLabelText('New property key'), {
      target: { value: 'portfolio' },
    });
    fireEvent.change(screen.getByLabelText('New JSON value'), {
      target: { value: 'purbayan.me' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add value' }));

    expect(runtime.getDocument('tab-1')?.store.getState().editor?.value).toBe(
      '{"name":"Ada","portfolio":"purbayan.me"}',
    );
    expect(screen.queryByRole('alert')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Add property' }));
    fireEvent.change(screen.getByLabelText('New property key'), {
      target: { value: 'details' },
    });
    fireEvent.change(screen.getByLabelText('New JSON value'), { target: { value: '{bad' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add value' }));

    expect(screen.getByRole('alert').textContent).toContain('Invalid JSON value:');
    expect(screen.getByRole('alert').textContent).not.toContain('Source mode');
    expect(runtime.getDocument('tab-1')?.store.getState().editor?.value).toBe(
      '{"name":"Ada","portfolio":"purbayan.me"}',
    );
  });
});
