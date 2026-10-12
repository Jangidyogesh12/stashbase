import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vite-plus/test';

import { sourceApi, textSource } from '@/test/fakes/documents';

import { registerSourceCleanup, renderSource } from './document-source.harness';

registerSourceCleanup();

describe('document Markdown source', () => {
  it('loads versioned Markdown into the Milkdown document surface', async () => {
    const api = sourceApi({
      load: vi.fn(async () =>
        textSource({ content: '# Plan\n\n- Keep the source', version: 'sha256:abc' }),
      ),
    });
    const { runtime } = renderSource(api);

    expect(screen.getByRole('status').textContent).toContain('Loading plan.md');
    const source = await screen.findByRole(
      'document',
      { name: 'plan.md Markdown content' },
      { timeout: 5_000 },
    );

    expect(await screen.findByRole('heading', { name: 'Plan' }, { timeout: 5_000 })).not.toBeNull();
    expect(source.querySelector('[contenteditable="true"]')).not.toBeNull(); // dom-contract: Milkdown/ProseMirror internals
    expect(screen.queryByLabelText('plan.md source')).toBeNull();
    expect(api.load).toHaveBeenCalledWith(
      { folderPath: '/project/notes', path: 'plan.md' },
      expect.any(AbortSignal),
    );
    await waitFor(() =>
      expect(runtime.navigation.store.getState().outline.headings).toEqual([
        expect.objectContaining({ id: 'plan', level: 1, text: 'Plan' }),
      ]),
    );
  });

  it('routes Markdown Find and links through the active document authority', async () => {
    const onNavigate = vi.fn();
    const onOpenExternal = vi.fn(async () => true);
    const api = sourceApi({
      load: vi.fn(async () =>
        textSource({
          content:
            '# Plan\n\nFind this phrase.\n\n[Details](details.md#part)\n\n[Website](https://example.com/docs)',
        }),
      ),
    });
    const { runtime } = renderSource(
      api,
      { folderPath: '/project/notes', path: 'guides/plan.md' },
      { onNavigate, onOpenExternal },
    );
    await screen.findByRole('heading', { name: 'Plan' }, { timeout: 5_000 });

    await waitFor(() => expect(runtime.navigation.store.getState().find.available).toBe(true));
    act(() => expect(runtime.navigation.openFind()).toBe(true));
    const input = await screen.findByRole('textbox', { name: 'Find in document' });
    expect(screen.getByRole('group', { name: 'Find matching options' })).not.toBeNull();
    expect(screen.getByRole('group', { name: 'Find result navigation' })).not.toBeNull();
    fireEvent.change(input, { target: { value: 'Find this phrase' } });
    await waitFor(() => expect(runtime.navigation.store.getState().find.total).toBe(1));

    fireEvent.click(screen.getByRole('link', { name: 'Details' }));
    expect(onNavigate).toHaveBeenCalledWith({
      anchor: 'part',
      source: { folderPath: '/project/notes', path: 'guides/details.md' },
    });
    fireEvent.click(screen.getByRole('link', { name: 'Website' }));
    await waitFor(() => expect(onOpenExternal).toHaveBeenCalledWith('https://example.com/docs'));
  });
});
