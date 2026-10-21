import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vite-plus/test';

import { createDocumentRuntime } from '@/features/documents/application/document-runtime';
import { DocumentSaveError, type DocumentSourcePort } from '@/features/documents/application/ports';
import { createDocumentQueryScope } from '@/features/documents/application/queries';
import { sourceApi, textSource } from '@/test/fakes/documents';
import { createTestQueryClient, queryWrapper } from '@/test/query';

import { useDocumentSource } from './use-document-source';

const disposers: Array<() => void> = [];
afterEach(() => {
  cleanup();
  disposers.splice(0).forEach((dispose) => dispose());
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function mount(overrides: Partial<DocumentSourcePort> = {}) {
  vi.useFakeTimers();
  const api = sourceApi({ load: vi.fn(async () => textSource()), ...overrides });
  const client = createTestQueryClient();
  const scope = {
    source: { folderPath: '/project/notes', path: 'plan.md' },
    generation: 1,
    id: 'plan',
  };
  const runtime = createDocumentRuntime({
    ...scope,
    activeFolderPath: scope.source.folderPath,
    queries: createDocumentQueryScope(client, scope),
  });
  disposers.push(() => {
    runtime.dispose();
    client.clear();
  });
  const view = renderHook(
    ({ active }) => {
      const state = useDocumentSource(runtime, api, active);
      // Subscribe to the same failure state that TextSurface renders.
      void state.source.isError;
      return state;
    },
    {
      initialProps: { active: true },
      wrapper: queryWrapper(client),
    },
  );
  await tick(1);
  return { ...view, api, runtime };
}

async function tick(ms = 2_001) {
  await act(async () => vi.advanceTimersByTimeAsync(ms));
}

it('adopts external text while the same document stays open', async () => {
  const { api, runtime } = await mount();
  vi.mocked(api.load).mockResolvedValue(textSource({ content: 'external edit', version: 'v2' }));
  await tick();
  expect(runtime.store.getState().editor).toMatchObject({
    value: 'external edit',
    baseline: 'external edit',
    version: 'v2',
  });
  expect(api.save).not.toHaveBeenCalled();
});

it('refreshes on native window focus without a visibility change', async () => {
  const { api, runtime } = await mount();
  vi.mocked(api.load).mockResolvedValue(textSource({ content: 'on return', version: 'v2' }));
  act(() => window.dispatchEvent(new Event('focus')));
  await tick(1);
  expect(runtime.store.getState().editor?.value).toBe('on return');
});

it('pauses inactive and hidden documents and catches up when shown', async () => {
  const { api, rerender, runtime } = await mount();
  vi.mocked(api.load).mockClear();
  rerender({ active: false });
  act(() => window.dispatchEvent(new Event('focus')));
  await tick();
  expect(api.load).not.toHaveBeenCalled();
  vi.mocked(api.load).mockResolvedValue(textSource({ content: 'next tab', version: 'v2' }));
  rerender({ active: true });
  await tick(1);
  expect(runtime.store.getState().editor?.value).toBe('next tab');

  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  vi.mocked(api.load).mockClear();
  await tick();
  expect(api.load).not.toHaveBeenCalled();
  vi.mocked(api.load).mockResolvedValue(textSource({ content: 'visible again', version: 'v3' }));
  visibility.mockReturnValue('visible');
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  await tick(1);
  expect(runtime.store.getState().editor?.value).toBe('visible again');
});

it('keeps held local edits and compares both versions on save', async () => {
  const { api, runtime } = await mount({
    save: vi.fn().mockRejectedValue(new DocumentSaveError('conflict', 'changed')),
  });
  runtime.holdEdits(() => runtime.change('local draft'));
  vi.mocked(api.load).mockResolvedValue(textSource({ content: 'external edit', version: 'v2' }));
  await tick();
  expect(runtime.store.getState().editor).toMatchObject({ value: 'local draft', version: 'v1' });
  await act(async () => {
    expect(await runtime.save(api)).toBe(false);
  });
  expect(runtime.store.getState().editor?.save).toMatchObject({
    kind: 'conflict',
    conflict: { editorContent: 'local draft', diskContent: 'external edit', diskVersion: 'v2' },
  });
});

it('retains usable text on refresh failure and recovers on the next check', async () => {
  const { api, runtime, result } = await mount();
  vi.mocked(api.load).mockRejectedValueOnce(new Error('offline'));
  await tick();
  expect(result.current.source.isError).toBe(true);
  expect(runtime.store.getState().editor?.value).toBe('# Plan');
  vi.mocked(api.load).mockResolvedValue(textSource({ content: 'recovered', version: 'v2' }));
  await tick();
  expect(result.current.source.isError).toBe(false);
  expect(runtime.store.getState().editor?.value).toBe('recovered');
});

it('does not restart a slow refresh and retires it when the document closes', async () => {
  const { api, runtime, unmount } = await mount();
  let signal: AbortSignal | undefined;
  vi.mocked(api.load)
    .mockClear()
    .mockImplementation((_source, captured) => {
      signal = captured;
      return new Promise(() => {});
    });
  await tick();
  act(() => window.dispatchEvent(new Event('focus')));
  await tick(4_001);
  expect(api.load).toHaveBeenCalledOnce();
  expect(signal?.aborted).toBe(false);
  unmount();
  runtime.dispose();
  expect(signal?.aborted).toBe(true);
  await tick();
  act(() => window.dispatchEvent(new Event('focus')));
  expect(api.load).toHaveBeenCalledOnce();
});

it('does not replace an accepted save with an older in-flight refresh', async () => {
  const { api, runtime } = await mount({
    save: vi.fn(async () => textSource({ content: 'saved draft', version: 'v3' })),
  });
  let finishRead: ((source: ReturnType<typeof textSource>) => void) | undefined;
  vi.mocked(api.load).mockImplementation(
    () =>
      new Promise((resolve) => {
        finishRead = resolve;
      }),
  );
  await tick();
  expect(finishRead).toBeDefined();
  act(() => runtime.change('saved draft'));
  await act(async () => {
    await runtime.save(api);
  });
  await act(async () => {
    finishRead?.(textSource({ content: 'old disk', version: 'v2' }));
  });
  await tick(1);
  expect(runtime.store.getState().editor).toMatchObject({ value: 'saved draft', version: 'v3' });
});
