import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vite-plus/test';

import { DOCUMENT_SOURCE_MESSAGES } from '@/features/documents/application/failure-messages';
import {
  DocumentSourceError,
  type DocumentSourcePort,
} from '@/features/documents/application/ports';
import { sourceApi, textSource } from '@/test/fakes/documents';

import { codeEditor, registerSourceCleanup, renderSource } from './document-source.harness';

registerSourceCleanup();

describe('document text editing', () => {
  it('marks a source from another member folder as read-only', async () => {
    const api = sourceApi({
      load: vi.fn(async () => textSource({ content: 'literal text', format: 'txt' })),
    });
    renderSource(api, { folderPath: '/project/archive', path: 'notes.txt' });

    await screen.findByLabelText('notes.txt source');
    const documentRegion = screen.getByRole('region', { name: 'notes.txt document' });
    expect(
      within(documentRegion).getByText('Read-only source from another project folder'),
    ).not.toBeNull();
  });

  it('keeps unsupported encoding explicit and retries in the same tab', async () => {
    const api = sourceApi({
      load: vi
        .fn<DocumentSourcePort['load']>()
        .mockRejectedValueOnce(
          new DocumentSourceError('unsupported-encoding', 'byte 0x80 at offset 12'),
        )
        .mockResolvedValueOnce(textSource({ content: 'now utf-8', format: 'txt', version: 'v2' })),
    });
    renderSource(api, { folderPath: '/project/notes', path: 'legacy.txt' });

    expect((await screen.findByRole('alert')).textContent).toContain(
      DOCUMENT_SOURCE_MESSAGES['unsupported-encoding'],
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));

    await screen.findByLabelText('legacy.txt source');
    expect(codeEditor('legacy.txt source').state.doc.toString()).toBe('now utf-8');
    expect(api.load).toHaveBeenCalledTimes(2);
  });

  it('aborts a pending source load when its tab closes', async () => {
    let capturedSignal: AbortSignal | null = null;
    const load = vi.fn<DocumentSourcePort['load']>();
    load.mockImplementation((_source, signal) => {
      capturedSignal = signal;
      return new Promise(() => {});
    });
    const { runtime } = renderSource(sourceApi({ load }));
    // The default tab is Markdown, whose viewer chunk is imported lazily.
    await waitFor(() => expect(capturedSignal).not.toBeNull(), { timeout: 5_000 });

    await act(async () => {
      await runtime.close('tab-1');
    });

    await waitFor(() => expect(capturedSignal?.aborted).toBe(true));
  });

  it('marks edits immediately and autosaves with the accepted version', async () => {
    const api = sourceApi({
      load: vi.fn(async () => textSource({ content: 'before\r\n', format: 'txt' })),
      save: vi.fn(async () => textSource({ content: 'after\r\n', format: 'txt', version: 'v2' })),
    });
    const { runtime } = renderSource(api, {
      folderPath: '/project/notes',
      path: 'notes.txt',
    });
    await screen.findByLabelText('notes.txt source');
    const editor = codeEditor('notes.txt source');
    vi.useFakeTimers();

    editor.dispatch({ changes: { from: 0, insert: 'after\n', to: editor.state.doc.length } });

    expect(runtime.getDocument('tab-1')?.store.getState().editor).toMatchObject({
      save: { kind: 'dirty' },
      value: 'after\n',
      version: 'v1',
    });
    expect(screen.queryByText('Unsaved')).toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(499));
    expect(api.save).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(api.save).toHaveBeenCalledOnce();
    expect(api.save).toHaveBeenCalledWith(
      { folderPath: '/project/notes', path: 'notes.txt' },
      { baseVersion: 'v1', content: 'after\n' },
      expect.any(AbortSignal),
    );
    expect(runtime.getDocument('tab-1')?.store.getState().editor?.save.kind).toBe('saved');
    expect(screen.queryByText('Saved')).toBeNull();
    expect(codeEditor('notes.txt source').state.doc.toString()).toBe('after\n');
  });

  it('keeps failed saves editable and offers retry without another toolbar', async () => {
    const api = sourceApi({
      load: vi.fn(async () => textSource({ content: 'before', format: 'txt' })),
      save: vi
        .fn<DocumentSourcePort['save']>()
        .mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValueOnce(textSource({ content: 'draft', format: 'txt', version: 'v2' })),
    });
    const { runtime } = renderSource(api, { folderPath: '/project/notes', path: 'plan.txt' });
    await screen.findByLabelText('plan.txt source');
    const editor = codeEditor('plan.txt source');
    editor.dispatch({ changes: { from: 0, insert: 'draft', to: editor.state.doc.length } });

    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry' })).not.toBeNull(), {
      timeout: 2_000,
    });
    expect(editor.state.doc.toString()).toBe('draft');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() =>
      expect(runtime.getDocument('tab-1')?.store.getState().editor?.save.kind).toBe('saved'),
    );
    expect(screen.queryByText('Saved')).toBeNull();
    expect(api.save).toHaveBeenCalledTimes(2);
  });
});
