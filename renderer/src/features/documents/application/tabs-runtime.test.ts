import { describe, expect, it, vi } from 'vite-plus/test';

import type { DocumentTextSaveResult } from '@/features/documents/domain/document';
import { externalSource } from '@/shared/domain/external-source';
import { documentQueryScope, sourceApi, textSource } from '@/test/fakes/documents';

import type { DocumentSourcePort } from './ports';
import { createDocumentTabsRuntime, type DocumentTabsRuntimeOptions } from './tabs-runtime';

function idFactory() {
  let next = 0;
  return () => `tab-${++next}`;
}

function createApi(): DocumentSourcePort {
  return sourceApi({
    save: vi.fn<DocumentSourcePort['save']>(async (_source, input) =>
      textSource({ content: input.content, version: 'saved' }),
    ),
  });
}

function makeDirty(runtime: ReturnType<typeof createDocumentTabsRuntime>, tabId: string) {
  const document = runtime.getDocument(tabId);
  document?.reconcile(textSource({ content: 'before' }));
  document?.change('draft');
  return document;
}

describe('Document tabs runtime', () => {
  it('restores fresh document runtimes and one active source', () => {
    const runtime = createDocumentTabsRuntime({
      api: createApi(),
      createId: idFactory(),
      createQueries: () => documentQueryScope(),
      folderPath: '/project/notes',
      generation: 3,
      restored: {
        activeTabId: 'tab-plan',
        tabs: [
          {
            id: 'tab-plan',
            source: { folderPath: '/project/notes', path: 'plan.md' },
          },
        ],
      },
    });

    expect(runtime.store.getState().activeTabId).toBe('tab-plan');
    expect(runtime.getDocument('tab-plan')?.scope).toEqual({
      generation: 1,
      id: 'tab-plan',
      source: { folderPath: '/project/notes', path: 'plan.md' },
    });
  });

  it('makes the runtime collection the duplicate-open authority', async () => {
    const createId = vi.fn(idFactory());
    const runtime = createDocumentTabsRuntime({
      api: createApi(),
      createId,
      createQueries: () => documentQueryScope(),
      folderPath: '/project/notes',
      generation: 1,
    });
    const source = { folderPath: '/project/notes', path: 'plan.md' };

    const first = await runtime.open(source);
    const repeated = await runtime.open({ ...source });

    expect(repeated).toBe(first);
    expect(runtime.store.getState().tabs).toHaveLength(1);
    expect(createId).toHaveBeenCalledOnce();
  });

  it('carries an anchor through the target tab runtime without duplicating its source', async () => {
    const runtime = createDocumentTabsRuntime({
      api: createApi(),
      createId: idFactory(),
      createQueries: () => documentQueryScope(),
      folderPath: '/project/notes',
      generation: 1,
    });
    const source = { folderPath: '/project/notes', path: 'plan.md' };

    await runtime.open(source, { anchor: 'details' });
    await runtime.open({ ...source }, { anchor: 'summary' });

    expect(runtime.store.getState().tabs).toHaveLength(1);
    expect(runtime.navigation.store.getState().pendingAnchor).toEqual({
      id: 'summary',
      tabId: 'tab-1',
    });
  });

  it('carries a search occurrence through a newly opened document', async () => {
    const runtime = createDocumentTabsRuntime({
      api: createApi(),
      createId: idFactory(),
      createQueries: () => documentQueryScope(),
      folderPath: '/project/notes',
      generation: 1,
    });
    const controller = {
      close: vi.fn(),
      next: vi.fn(() => ({ current: 2, total: 2 })),
      previous: vi.fn(() => ({ current: 1, total: 2 })),
      setQuery: vi.fn(() => ({ current: 1, total: 2 })),
    };

    await runtime.open(
      { folderPath: '/project/notes', path: 'plan.md' },
      {
        search: {
          caseSensitive: false,
          occurrenceIndex: 1,
          query: 'plan',
          wholeWord: false,
        },
      },
    );
    runtime.navigation.claimFind('tab-1', Symbol('viewer'), controller);

    await vi.waitFor(() => expect(runtime.navigation.store.getState().find.current).toBe(2));
    expect(controller.setQuery).toHaveBeenCalledWith('plan', {
      caseSensitive: false,
      wholeWord: false,
    });
  });

  it('cancels only the closed document and rejects its stale work', async () => {
    const runtime = createDocumentTabsRuntime({
      api: createApi(),
      createId: idFactory(),
      createQueries: () => documentQueryScope(),
      folderPath: '/project/notes',
      generation: 1,
    });
    const first = await runtime.open({
      folderPath: '/project/notes',
      path: 'one.md',
    });
    const second = await runtime.open({
      folderPath: '/project/notes',
      path: 'two.md',
    });
    const capturedScope = first?.capture();
    const completion = vi.fn();

    await runtime.close('tab-1');

    expect(first?.signal.aborted).toBe(true);
    expect(second?.signal.aborted).toBe(false);
    expect(capturedScope && first?.accept(capturedScope, completion)).toBe(false);
    expect(runtime.store.getState().activeTabId).toBe('tab-2');
  });

  it('disposes every child and rejects completions from an older folder scope', async () => {
    const runtime = createDocumentTabsRuntime({
      api: createApi(),
      createId: idFactory(),
      createQueries: () => documentQueryScope(),
      folderPath: '/project/notes',
      generation: 2,
    });
    const document = await runtime.open({
      folderPath: '/project/notes',
      path: 'one.md',
    });
    const completion = vi.fn();

    expect(
      runtime.accept(
        {
          generation: 0,
          scope: { folderPath: '/project/notes', generation: 1 },
        },
        completion,
      ),
    ).toBe(false);
    runtime.dispose();
    runtime.dispose();

    expect(runtime.signal.aborted).toBe(true);
    expect(document?.signal.aborted).toBe(true);
    expect(runtime.store.getState().lifecycle).toBe('disposed');
    expect(runtime.accept({ generation: 0, scope: runtime.scope }, completion)).toBe(false);
    expect(completion).not.toHaveBeenCalled();
  });

  it('projects only active-folder relative identities for Workspace persistence', async () => {
    const runtime = createDocumentTabsRuntime({
      api: createApi(),
      createId: idFactory(),
      createQueries: () => documentQueryScope(),
      folderPath: '/project/notes',
      generation: 1,
    });
    await runtime.open({ folderPath: '/project/notes', path: 'inside.md' });
    await runtime.open({ folderPath: '/project/archive', path: 'outside.md' });

    const persisted = runtime.toSession();
    expect(persisted.tabs).toEqual([{ id: 'tab-1', path: 'inside.md' }]);
    expect(persisted.activeTabId).toBeNull();
  });

  it('keeps the current tab mounted when its save barrier fails', async () => {
    const api = sourceApi({
      save: vi.fn(async () => {
        throw new Error('offline');
      }),
    });
    const runtime = createDocumentTabsRuntime({
      api,
      createId: idFactory(),
      createQueries: () => documentQueryScope(),
      folderPath: '/project/notes',
      generation: 1,
      restored: {
        activeTabId: 'one',
        tabs: [
          {
            id: 'one',
            source: { folderPath: '/project/notes', path: 'one.md' },
          },
          {
            id: 'two',
            source: { folderPath: '/project/notes', path: 'two.md' },
          },
        ],
      },
    });
    makeDirty(runtime, 'one');

    await expect(runtime.activate('two')).resolves.toBe(true);
    await expect(runtime.close('one')).resolves.toBe(false);

    expect(runtime.store.getState().activeTabId).toBe('two');
    expect(runtime.getDocument('one')?.store.getState().editor?.value).toBe('draft');
    expect(runtime.getDocument('one')?.signal.aborted).toBe(false);
  });

  it('waits for the latest live value before closing a dirty tab', async () => {
    const finishSaves: Array<(value: DocumentTextSaveResult) => void> = [];
    const api = sourceApi({
      save: vi.fn(
        () =>
          new Promise<DocumentTextSaveResult>((resolve) => {
            finishSaves.push(resolve);
          }),
      ),
    });
    const runtime = createDocumentTabsRuntime({
      api,
      createId: idFactory(),
      createQueries: () => documentQueryScope(),
      folderPath: '/project/notes',
      generation: 1,
    });
    const document = await runtime.open({
      folderPath: '/project/notes',
      path: 'one.md',
    });
    makeDirty(runtime, 'tab-1');

    const closing = runtime.close('tab-1');
    await vi.waitFor(() => expect(api.save).toHaveBeenCalledOnce());
    document?.change('newer draft');
    expect(document?.signal.aborted).toBe(false);

    finishSaves.shift()?.(textSource({ content: 'draft', version: 'v2' }));
    await vi.waitFor(() => expect(api.save).toHaveBeenCalledTimes(2));
    finishSaves.shift()?.(textSource({ content: 'newer draft', version: 'v3' }));

    await expect(closing).resolves.toBe(true);
    expect(document?.signal.aborted).toBe(true);
    expect(api.save).toHaveBeenLastCalledWith(
      { folderPath: '/project/notes', path: 'one.md' },
      { baseVersion: 'v2', content: 'newer draft' },
      expect.any(AbortSignal),
    );
  });

  it('settles an edit the surface still holds before saving or reconciling over it', async () => {
    const api = createApi();
    const runtime = createDocumentTabsRuntime({
      api,
      createId: idFactory(),
      createQueries: () => documentQueryScope(),
      folderPath: '/project/notes',
      generation: 1,
    });
    const document = await runtime.open({ folderPath: '/project/notes', path: 'one.md' });
    document?.reconcile(textSource({ content: 'before', version: 'v1' }));
    let held: string | null = 'typed';
    document?.holdEdits(() => {
      if (held === null) return;
      document.change(held);
      held = null;
    });

    document?.reconcile(textSource({ content: 'external', version: 'v2' }));
    expect(document?.store.getState().editor?.value).toBe('typed');

    held = 'typed more';
    await expect(runtime.close('tab-1')).resolves.toBe(true);
    expect(api.save).toHaveBeenLastCalledWith(
      { folderPath: '/project/notes', path: 'one.md' },
      { baseVersion: 'v1', content: 'typed more' },
      expect.any(AbortSignal),
    );
  });

  it('retires a token once the open set has moved past it', async () => {
    const runtime = createDocumentTabsRuntime({
      api: createApi(),
      createId: idFactory(),
      createQueries: () => documentQueryScope(),
      folderPath: '/project/notes',
      generation: 1,
    });
    const captured = runtime.capture();
    const completion = vi.fn();

    await runtime.open({ folderPath: '/project/notes', path: 'one.md' });

    expect(runtime.accept(captured, completion)).toBe(false);
    expect(runtime.accept(runtime.capture(), completion)).toBe(true);
    expect(completion).toHaveBeenCalledOnce();
  });

  it('does not replace a usable preview or add history when opening fails', async () => {
    const prepare = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce('File is missing.');
    const runtime = createDocumentTabsRuntime({
      api: createApi(),
      prepare,
      createId: idFactory(),
      createQueries: () => documentQueryScope(),
      folderPath: '/project/notes',
      generation: 1,
    });
    const first = await runtime.open(notes('one.md'), { preview: true });
    expect(await runtime.open(notes('missing.md'), { preview: true })).toBeNull();
    expect(runtime.getDocument('tab-1')).toBe(first);
    expect(runtime.activeSource()?.path).toBe('one.md');
    expect(runtime.history.store.getState().entries).toHaveLength(1);
    expect(runtime.store.getState().openFailure?.source.path).toBe('missing.md');
    runtime.dispose();
  });
});

const notes = (path: string) => ({ folderPath: '/project/notes', path });
/** The open set as one string per tab, a star marking the preview. */
const shape = (runtime: ReturnType<typeof createDocumentTabsRuntime>) =>
  runtime.store.getState().tabs.map((tab) => `${tab.source.path}${tab.preview ? '*' : ''}`);

describe('Document tabs runtime previews and history', () => {
  function createRuntime(restored: DocumentTabsRuntimeOptions['restored'] = null) {
    return createDocumentTabsRuntime({
      api: createApi(),
      createId: idFactory(),
      createQueries: () => documentQueryScope(),
      folderPath: '/project/notes',
      generation: 1,
      restored,
    });
  }

  it('reuses the one preview tab for each browse and keeps it when asked or edited', async () => {
    const runtime = createRuntime();

    const first = await runtime.open(notes('one.md'), { preview: true });
    await runtime.open(notes('two.md'), { preview: true });
    expect(shape(runtime)).toEqual(['two.md*']);
    // The replaced preview's document is retired with its tab.
    expect(runtime.getDocument('tab-1')).toBeNull();
    expect(first?.store.getState().lifecycle).toBe('disposed');

    // Asking keeps the preview, and the next browse goes beside it.
    expect(runtime.keep('tab-2')).toBe(true);
    expect(runtime.keep('tab-1')).toBe(false);
    await runtime.open(notes('three.md'), { preview: true });
    expect(shape(runtime)).toEqual(['two.md', 'three.md*']);

    // An edit keeps the preview the moment its text moves.
    makeDirty(runtime, 'tab-3');
    expect(shape(runtime)).toEqual(['two.md', 'three.md']);

    // Opening a previewed source as kept keeps that tab rather than adding one.
    await runtime.open(notes('four.md'), { preview: true });
    await runtime.open(notes('four.md'));
    expect(shape(runtime)).toEqual(['two.md', 'three.md', 'four.md']);
  });

  it('leaves preview tabs out of the saved session', async () => {
    const runtime = createRuntime();
    await runtime.open(notes('one.md'));
    await runtime.open(notes('two.md'), { preview: true });

    expect(runtime.toSession()).toEqual({
      activeTabId: null,
      tabs: [{ id: 'tab-1', path: 'one.md' }],
    });
  });

  it('steps back through visited sources, using an open tab or else the preview', async () => {
    const runtime = createRuntime();
    await runtime.open(notes('one.md'));
    await runtime.open(notes('two.md'), { preview: true, anchor: 'details' });
    await runtime.open(notes('three.md'), { preview: true });
    expect(shape(runtime)).toEqual(['one.md', 'three.md*']);
    expect(runtime.history.previous()?.source.path).toBe('two.md');

    // The replaced preview comes back as the preview, at the place it was
    // opened to, and never as a new kept tab.
    const back = await runtime.back();
    expect(back?.scope.source.path).toBe('two.md');
    expect(shape(runtime)).toEqual(['one.md', 'two.md*']);
    expect(runtime.navigation.store.getState().pendingAnchor).toEqual({
      id: 'details',
      tabId: back?.scope.id,
    });

    // A source still open is used as it is.
    await runtime.back();
    expect(runtime.activeSource()?.path).toBe('one.md');
    expect(shape(runtime)).toEqual(['one.md', 'two.md*']);
    expect(runtime.history.previous()).toBeNull();
    expect(await runtime.back()).toBeNull();

    await runtime.forward();
    expect(runtime.activeSource()?.path).toBe('two.md');
    // The history's own steps are returns, not new visits.
    const visited = () =>
      runtime.history.store.getState().entries.map((entry) => entry.source.path);
    expect(visited()).toEqual(['one.md', 'two.md', 'three.md']);

    // A fresh visit from the middle cuts off what lay ahead.
    await runtime.open(notes('four.md'), { preview: true });
    expect(visited()).toEqual(['one.md', 'two.md', 'four.md']);
    expect(runtime.history.next()).toBeNull();
  });

  it('edits an external text file in place but keeps it out of the session and closed history', async () => {
    const runtime = createRuntime();
    const outside = externalSource('grant-token-abcdefghijklmn', '/Users/reader/Desktop/notes.md');
    const visited = () =>
      runtime.history.store.getState().entries.map((entry) => entry.source.path);
    await runtime.open(notes('one.md'));
    const opened = await runtime.open(outside);
    expect(opened?.store.getState().access).toBe('editable');
    const pdf = await runtime.open(
      externalSource('grant-token-abcdefghijklmn', '/Users/reader/paper.pdf'),
    );
    expect(pdf?.store.getState().access).toBe('read-only');
    await runtime.closeSource(
      externalSource('grant-token-abcdefghijklmn', '/Users/reader/paper.pdf'),
    );
    expect(runtime.toSession().tabs).toEqual([{ id: 'tab-1', path: 'one.md' }]);
    expect(visited()).toEqual(['one.md', '/Users/reader/Desktop/notes.md']);

    // Its read grant ends with the tab, so history cannot step back to it.
    await runtime.closeSource(outside);
    expect(visited()).toEqual(['one.md']);
    expect(runtime.history.previous()).toBeNull();
  });

  it('records a tab activation as a visit but not the neighbour a close lands on', async () => {
    const runtime = createRuntime({
      activeTabId: 'tab-plan',
      tabs: [{ id: 'tab-plan', source: notes('plan.md') }],
    });
    const visited = () =>
      runtime.history.store.getState().entries.map((entry) => entry.source.path);
    // The tab the window came back on is where the reader starts.
    expect(visited()).toEqual(['plan.md']);

    await runtime.open(notes('two.md'));
    await runtime.activate('tab-plan');
    expect(visited()).toEqual(['plan.md', 'two.md', 'plan.md']);

    await runtime.close('tab-plan');
    expect(runtime.activeSource()?.path).toBe('two.md');
    expect(visited()).toEqual(['plan.md', 'two.md', 'plan.md']);
  });
});
