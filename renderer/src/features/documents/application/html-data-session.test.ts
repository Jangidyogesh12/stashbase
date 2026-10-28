import { afterEach, expect, it, vi } from 'vite-plus/test';

import { documentQueryScope, sourceApi } from '@/test/fakes/documents';

import { DocumentSaveError, DocumentSourceError, type DocumentSourcePort } from './ports';
import { createDocumentTabsRuntime } from './tabs-runtime';

const runtimes: ReturnType<typeof createDocumentTabsRuntime>[] = [];
afterEach(() => {
  runtimes.splice(0).forEach((runtime) => runtime.dispose());
  vi.useRealTimers();
});

function setup(initial: string | null = '{"name":"before","count":1.00}') {
  let disk = initial;
  let version = 'v1';
  let id = 0;
  const api = sourceApi({
    load: vi.fn(async () => {
      if (disk === null) throw new DocumentSourceError('missing', 'missing');
      return { content: disk, format: 'json' as const, version };
    }),
    save: vi.fn<DocumentSourcePort['save']>(async (_source, input) => {
      if (input.baseVersion !== (disk === null ? 'absent' : version))
        throw new DocumentSaveError('conflict', 'changed');
      disk = input.content;
      version += '+';
      return { content: disk, format: 'json', version };
    }),
  });
  const runtime = createDocumentTabsRuntime({
    api,
    createId: () => `tab-${++id}`,
    createQueries: () => documentQueryScope(),
    folderPath: '/project',
    generation: 1,
  });
  runtimes.push(runtime);
  return {
    api,
    runtime,
    disk: () => disk,
    external(content: string) {
      disk = content;
      version += '!';
    },
  };
}

it('shares the JSON draft, autosaves updates, preserves source spelling, and saves on HTML close', async () => {
  vi.useFakeTimers();
  const fixture = setup();
  const html = required(
    await fixture.runtime.open({ folderPath: '/project', path: 'pages/form.html' }),
  );
  const data = required(html.htmlData);
  expect(await data.load()).toEqual({ name: 'before', count: 1 });
  const json = required(data.store.getState().document);
  expect(fixture.runtime.store.getState().activeTabId).toBe(html.scope.id);
  await data.update('{"name":"after","count":1}');
  expect(json.store.getState().editor?.value).toBe('{"name":"after","count":1.00}');
  await vi.advanceTimersByTimeAsync(1000);
  expect(fixture.api.save).toHaveBeenCalledWith(
    { folderPath: '/project', path: 'pages/form.json' },
    { baseVersion: 'v1', content: '{"name":"after","count":1.00}' },
    expect.any(AbortSignal),
  );
  expect(await fixture.runtime.open({ folderPath: '/project', path: 'pages/form.json' })).toBe(
    json,
  );
  expect(await fixture.runtime.close(json.scope.id)).toBe(true);
  await data.update('{"name":"closing","count":1}');
  expect(await fixture.runtime.close(html.scope.id)).toBe(true);
  expect(fixture.disk()).toBe('{"name":"closing","count":1.00}');
  await expect(data.update('{}')).rejects.toThrow('closed or moved');
  const reopened = await fixture.runtime.open({
    folderPath: '/project',
    path: 'pages/form.html',
  });
  expect(await required(reopened?.htmlData).load()).toEqual({ name: 'closing', count: 1 });
});

it('keeps explicit asset data out of tabs, saves on rename, and rebinds under the renamed folder', async () => {
  const fixture = setup();
  const html = required(
    await fixture.runtime.open({ folderPath: '/project', path: 'Untitled/index.html' }),
  );
  const data = required(html.htmlData);
  await data.load('./assets/notes.json');
  expect(fixture.runtime.store.getState().tabs).toHaveLength(1);
  expect(data.store.getState().document?.scope.source.path).toBe('Untitled/assets/notes.json');
  await expect(data.load('./assets/other.json')).rejects.toThrow('different data file');
  await data.update('{"name":"kept on rename","count":1}');
  expect(await fixture.runtime.mutate('Untitled', async () => 'Renamed')).toBe(true);
  expect(fixture.disk()).toContain('kept on rename');
  expect(html.scope.source.path).toBe('Renamed/index.html');
  const rebound = required(html.htmlData);
  expect(rebound).not.toBe(data);
  await rebound.load('./assets/notes.json');
  expect(rebound.store.getState().document?.scope.source.path).toBe('Renamed/assets/notes.json');
  await rebound.update('{"name":"saved after rename","count":1}');
  const hiddenId = required(rebound.store.getState().document).scope.id;
  expect(await fixture.runtime.close(html.scope.id)).toBe(true);
  await Promise.resolve();
  expect(fixture.disk()).toContain('saved after rename');
  expect(fixture.runtime.getDocument(hiddenId)).toBeNull();
  expect(fixture.runtime.store.getState().tabs).toHaveLength(0);
});

it('preserves a draft on disk conflicts and refuses close until the JSON comparison is resolved', async () => {
  const fixture = setup();
  const html = required(await fixture.runtime.open({ folderPath: '/project', path: 'form.html' }));
  const data = required(html.htmlData);
  await data.load();
  await data.update('{"name":"mine"}');
  fixture.external('{"name":"agent"}');
  await expect(data.save()).rejects.toThrow('not saved');
  expect(fixture.disk()).toBe('{"name":"agent"}');
  expect(required(data.store.getState().document).store.getState().editor?.value).toBe(
    '{"name":"mine"}',
  );
  expect(await fixture.runtime.close(html.scope.id)).toBe(false);
  expect(await fixture.runtime.flush()).toBe(false);
  const json = required(data.store.getState().document);
  expect(fixture.runtime.store.getState().activeTabId).toBe(json.scope.id);
  expect(await json.resolveConflict(fixture.api, 'reload')).toBe(true);
  expect(await data.load()).toEqual({ name: 'agent' });
});

it('rejects stale form updates after another editor changes the shared draft', async () => {
  const fixture = setup();
  const html = required(await fixture.runtime.open({ folderPath: '/project', path: 'form.html' }));
  const data = required(html.htmlData);
  await data.load();
  const json = required(data.store.getState().document);
  json.change('{"name":"newer"}');
  await expect(data.update('{"name":"stale"}')).rejects.toThrow('another editor');
  expect(await data.load()).toEqual({ name: 'newer' });
  await data.update('{"name":"accepted"}');
  await data.save();
  expect(fixture.disk()).toBe('{"name":"accepted"}');
});

it('creates an absent sibling only when data is written, rejects cross-project use and late loads after close', async () => {
  const fixture = setup(null);
  const html = required(await fixture.runtime.open({ folderPath: '/project', path: 'new.htm' }));
  expect(await required(html.htmlData).load()).toBe(null);
  expect(fixture.disk()).toBe(null);
  await required(html.htmlData).save();
  expect(fixture.disk()).toBe('null');
  const foreign = required(
    await fixture.runtime.open({ folderPath: '/another', path: 'form.html' }),
  );
  await expect(required(foreign.htmlData).load()).rejects.toThrow('current project');
  const later = required(
    await fixture.runtime.open({ folderPath: '/project', path: 'later.html' }),
  );
  let finish!: (value: Awaited<ReturnType<DocumentSourcePort['load']>>) => void;
  vi.mocked(fixture.api.load).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const loading = required(later.htmlData).load();
  const refused = expect(loading).rejects.toThrow('no longer open');
  await fixture.runtime.close(later.scope.id);
  finish({ content: '{}', format: 'json', version: 'late' });
  await refused;
  expect(fixture.runtime.openSources().some((source) => source.path === 'later.json')).toBe(false);
});

it('keeps newer input during an in-flight save and refuses a renamed binding', async () => {
  const fixture = setup();
  const html = required(await fixture.runtime.open({ folderPath: '/project', path: 'form.html' }));
  const data = required(html.htmlData);
  await data.load();
  await data.update('{"name":"first"}');
  let finish!: () => void;
  const original = fixture.api.save;
  const first = vi
    .fn<DocumentSourcePort['save']>()
    .mockImplementationOnce(async (...args) => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return original(...args);
    })
    .mockImplementation(original);
  fixture.api.save = first;
  const saving = data.save();
  await data.update('{"name":"second"}');
  finish();
  await saving;
  expect(fixture.disk()).toBe('{"name":"second"}');
  const json = required(data.store.getState().document);
  json.rebind({ folderPath: '/project', path: 'renamed.json' }, () => documentQueryScope());
  await expect(data.update('{}')).rejects.toThrow('Load the form data again');
});

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new Error('Expected the form document to exist.');
  return value;
}

it('does not let a slow load roll back a newer accepted save', async () => {
  const fixture = setup();
  const html = required(await fixture.runtime.open({ folderPath: '/project', path: 'form.html' }));
  const data = required(html.htmlData);
  await data.load();
  let finish!: (value: Awaited<ReturnType<DocumentSourcePort['load']>>) => void;
  vi.mocked(fixture.api.load).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const loading = data.load();
  await data.update('{"name":"newer"}');
  await data.save();
  finish({ content: '{"name":"old"}', format: 'json', version: 'old' });
  expect(await loading).toEqual({ name: 'newer' });
  expect(required(data.store.getState().document).store.getState().editor?.version).toBe('v1+');
});

it('refreshes saved JSON editor and disk changes without reloading for its own writes', async () => {
  const fixture = setup();
  const html = required(await fixture.runtime.open({ folderPath: '/project', path: 'form.html' }));
  const data = required(html.htmlData);
  await data.load();
  const json = required(data.store.getState().document);
  await data.update('{"name":"form"}');
  await data.save();
  expect(data.store.getState().revision).toBe(0);
  json.change('{"name":"source"}');
  expect(data.store.getState().revision).toBe(0);
  await json.save(fixture.api);
  expect(data.store.getState().revision).toBe(1);
  await expect(data.update('{"name":"stale"}')).rejects.toThrow('another editor');
  expect(await data.load()).toEqual({ name: 'source' });
  fixture.external('{"name":"external"}');
  await data.refresh();
  expect(data.store.getState().revision).toBe(2);
  expect(await data.load()).toEqual({ name: 'external' });
  await data.refresh();
  expect(data.store.getState().revision).toBe(2);
});

it('retains the usable form on malformed disk data and protects pending input during refresh', async () => {
  const fixture = setup();
  const html = required(await fixture.runtime.open({ folderPath: '/project', path: 'form.html' }));
  const data = required(html.htmlData);
  await data.load();
  fixture.external('{"name":');
  await data.refresh();
  expect(data.store.getState()).toMatchObject({ revision: 0, refreshFailed: true });
  expect(required(data.store.getState().document).store.getState().editor?.value).toContain(
    'before',
  );
  fixture.external('{"name":"valid"}');
  await data.refresh();
  expect(data.store.getState()).toMatchObject({ revision: 1, refreshFailed: false });
  await data.load();

  let finish!: (value: Awaited<ReturnType<DocumentSourcePort['load']>>) => void;
  vi.mocked(fixture.api.load).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const refreshing = data.refresh();
  await data.update('{"name":"pending"}');
  fixture.external('{"name":"disk"}');
  finish({ content: '{"name":"disk"}', format: 'json', version: 'external' });
  await refreshing;
  await data.refresh();
  expect(data.store.getState().revision).toBe(1);
  expect(required(data.store.getState().document).store.getState().editor?.value).toBe(
    '{"name":"pending"}',
  );
  await expect(data.save()).rejects.toThrow('not saved');
  expect(fixture.disk()).toBe('{"name":"disk"}');
});
