import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vite-plus/test';

import { DocumentSaveError, type DocumentSourcePort } from '@/features/documents/application/ports';
import { sourceApi, textSource } from '@/test/fakes/documents';

import { codeEditor, registerSourceCleanup, renderSource } from './document-source.harness';

registerSourceCleanup();

describe('document save conflict', () => {
  it('compares both conflict versions and turns merge into an editable draft', async () => {
    const api = sourceApi({
      load: vi
        .fn<DocumentSourcePort['load']>()
        .mockResolvedValueOnce(textSource({ content: 'shared\nbefore', format: 'txt' }))
        .mockResolvedValueOnce(
          textSource({ content: 'shared\ndisk change', format: 'txt', version: 'v2' }),
        ),
      save: vi
        .fn<DocumentSourcePort['save']>()
        .mockRejectedValueOnce(
          new DocumentSaveError('conflict', 'changed', { currentVersion: 'v2' }),
        )
        .mockResolvedValue(
          textSource({ content: 'Merged\n=======', format: 'txt', version: 'v3' }),
        ),
    });
    const { runtime } = renderSource(api, { folderPath: '/project/notes', path: 'plan.txt' });
    await screen.findByLabelText('plan.txt source');
    const editor = codeEditor('plan.txt source');
    editor.dispatch({
      changes: { from: 0, insert: 'shared\neditor change', to: editor.state.doc.length },
    });

    await act(async () => {
      await runtime.getDocument('tab-1')?.save(api);
    });

    expect(await screen.findByRole('heading', { name: 'plan.txt changed on disk' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Use disk version' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Merge' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Keep my version' })).not.toBeNull();
    expect(screen.getByText('disk change')).not.toBeNull();
    expect(screen.getByText('editor change')).not.toBeNull();

    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    vi.useRealTimers();
    await screen.findByLabelText('plan.txt source');
    const merged = codeEditor('plan.txt source').state.doc.toString();
    expect(merged).toContain('<<<<<<< Editor Version\neditor change');
    expect(merged).toContain('=======\ndisk change\n>>>>>>> Disk Version');
    expect(runtime.getDocument('tab-1')?.store.getState().editor).toMatchObject({
      save: { kind: 'merging' },
      version: 'v2',
    });
    expect(api.save).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Finish merge' }));
    expect(
      await screen.findByText('Resolve the marked conflicts before finishing the merge.'),
    ).not.toBeNull();
    expect(api.save).toHaveBeenCalledOnce();
    const mergeEditor = codeEditor('plan.txt source');
    act(() =>
      mergeEditor.dispatch({
        changes: { from: 0, to: mergeEditor.state.doc.length, insert: 'Merged\n=======' },
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Finish merge' }));
    await waitFor(() =>
      expect(runtime.getDocument('tab-1')?.store.getState().editor?.save.kind).toBe('saved'),
    );
    expect(api.save).toHaveBeenLastCalledWith(
      expect.anything(),
      { baseVersion: 'v2', content: 'Merged\n=======' },
      expect.any(AbortSignal),
    );
  });
});
