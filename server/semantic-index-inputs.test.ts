import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { syncIndex } from './sync.ts';
import type { Indexer } from './indexer.ts';
import { MfsIndexer, prepareForIndex } from './indexer.mfs.ts';
import { getDaemon } from './mfs-daemon.ts';
import {
  hasNoExtractableText,
  indexableFileSizeError,
  MAX_INDEXABLE_BYTES,
  RECONCILE_BATCH_SIZE,
} from './indexable.ts';

for (const [source, content] of [
  ['/project/Data.JSON', '\uFEFF{\r\n  "z": 1,\r\n  "broken":\r\n'],
  ['/project/README.TXT', '\uFEFFheading-like # source\r\n[link](note.md)\r\n'],
] as const) {
  test(`${path.extname(source).toLowerCase()} indexing keeps literal UTF-8`, () => {
    const prepared = prepareForIndex(source, content);
    assert.equal(prepared, content);
  });
}

test('direct-text admission rejects empty and oversized input', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stashbase-direct-admission-'));
  try {
    const empty = path.join(root, 'empty.json');
    const whitespace = path.join(root, 'space.txt');
    const oversized = path.join(root, 'large.json');
    fs.writeFileSync(empty, '');
    fs.writeFileSync(whitespace, '  \n\t');
    fs.closeSync(fs.openSync(oversized, 'w'));
    fs.truncateSync(oversized, MAX_INDEXABLE_BYTES + 1);
    assert.equal(indexableFileSizeError(empty), 'empty file');
    assert.equal(hasNoExtractableText(whitespace), true);
    assert.match(indexableFileSizeError(oversized) ?? '', /too large/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('TXT reconcile removes a stale row instead of indexing invalid UTF-8', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stashbase-invalid-txt-reconcile-'));
  try {
    const invalid = path.join(root, 'broken.txt');
    fs.writeFileSync(invalid, Buffer.from([0x6e, 0x65, 0x80, 0x64, 0x6c, 0x65]));
    const upserts: string[] = [];
    const deletes: string[] = [];
    const indexer = {
      listDocuments: async () => [invalid],
      upsertFile: async (source: string) => {
        upserts.push(source);
        return { outcome: 'updated' as const };
      },
      deleteFile: async (source: string) => { deletes.push(source); },
    } as unknown as Indexer;
    const result = await syncIndex(indexer, root);
    assert.deepEqual(upserts, []);
    assert.deepEqual(deletes, [invalid]);
    assert.deepEqual(result.failed, [{ name: 'broken.txt', error: 'source text could not be decoded safely' }]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('JSON reconcile lets MFS classify content and treats an external rename as add plus remove', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stashbase-json-reconcile-'));
  try {
    const added = path.join(root, 'added.json');
    const modified = path.join(root, 'modified.JSON');
    const deleted = path.join(root, 'deleted.json');
    const oldName = path.join(root, 'old.json');
    const renamed = path.join(root, 'renamed.JSON');
    fs.writeFileSync(added, '{"added": true}');
    fs.writeFileSync(modified, '{ malformed modified');
    fs.writeFileSync(renamed, '{"same": true}');
    const events: string[] = [];
    const indexer = {
      listDocuments: async () => [modified, deleted, oldName],
      upsertFile: async (source: string) => {
        events.push(`upsert:${source}`);
        return {
          outcome: source === modified ? 'updated' as const : 'added' as const,
        };
      },
      deleteFile: async (source: string) => { events.push(`delete:${source}`); },
    } as unknown as Indexer;
    const result = await syncIndex(indexer, root);
    assert.equal(events.length, 5);
    assert.deepEqual(result.added, ['added.json', 'renamed.JSON']);
    assert.deepEqual(result.modified, ['modified.JSON']);
    assert.deepEqual(result.removed, ['deleted.json', 'old.json']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});


test('reconcile offers text to MFS for exact search without an embedding key', async () => {
  let listed = false;
  let upserted = false;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stashbase-no-key-'));
  try {
    fs.writeFileSync(path.join(root, 'note.md'), 'available to MFS grep');
    const result = await syncIndex({
      listDocuments: async () => { listed = true; return []; },
      upsertFile: async () => { upserted = true; return { outcome: 'added' }; },
    } as unknown as Indexer, root);
    assert.equal(listed, true);
    assert.equal(upserted, true);
    assert.deepEqual(result, { added: ['note.md'], modified: [], removed: [], failed: [] });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('reconcile admits sources beneath a hidden cloud parent while excluding hidden project directories', async (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'stashbase-cloud-parent-'));
  const root = path.join(scratch, '.shortcut-targets-by-id', 'drive-id', 'Project');
  const nested = path.join(root, '.private', 'OtherProject');
  fs.mkdirSync(path.join(root, 'notes'), { recursive: true });
  fs.mkdirSync(nested, { recursive: true });
  fs.writeFileSync(path.join(root, 'notes', 'visible.md'), 'ReplaySSM appears here');
  fs.writeFileSync(path.join(root, '.private', 'hidden.md'), 'Do not index this');
  fs.writeFileSync(path.join(nested, 'owned.md'), 'Visible within the nested project');
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));

  const calls: Array<{ op: string; path: string }> = [];
  t.mock.method(getDaemon(), 'knownBindings', () => new Map([
    [root, { provider: 'openai' as const }],
    [nested, { provider: 'openai' as const }],
  ]));
  t.mock.method(getDaemon(), 'call', async (op: string, args: Record<string, unknown>) => {
    calls.push({ op, path: String(args.path) });
    return { outcome: 'added', total_ms: 1 };
  });

  const indexer = new MfsIndexer();
  t.mock.method(indexer, 'listDocuments', async () => []);
  const result = await syncIndex(indexer, root);
  assert.deepEqual(result, { added: ['notes/visible.md'], modified: [], removed: [], failed: [] });
  assert.deepEqual(calls, [{ op: 'upsert', path: path.join(root, 'notes', 'visible.md') }]);
  assert.deepEqual(await indexer.upsertFile(path.join(root, '.private', 'hidden.md'), 'hidden'), { outcome: 'removed' });
  assert.deepEqual(calls.at(-1), { op: 'delete', path: path.join(root, '.private', 'hidden.md') });
  assert.deepEqual(await indexer.upsertFile(path.join(nested, 'owned.md'), 'nested'), { outcome: 'added' });
  assert.deepEqual(calls.at(-1), { op: 'upsert', path: path.join(nested, 'owned.md') });
});


test('reconcile excludes media while preserving source files and admitting text', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stashbase-media-index-'));
  try {
    for (const name of ['voice.wav', 'movie.mp4', 'note.md']) fs.writeFileSync(path.join(root, name), 'source text');
    const admitted: string[] = [];
    await syncIndex({
      listDocuments: async () => [],
      upsertFile: async (source: string) => { admitted.push(path.basename(source)); return { outcome: 'added' }; },
    } as unknown as Indexer, root);
    assert.deepEqual(admitted, ['note.md']);
    assert.deepEqual(fs.readdirSync(root).sort(), ['movie.mp4', 'note.md', 'voice.wav']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('an unreadable subtree cannot authorize removal of existing projections', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stashbase-incomplete-scan-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const child = path.join(root, 'notes');
  fs.mkdirSync(child);
  const source = path.join(child, 'note.md');
  fs.writeFileSync(source, 'still present');
  const readdir = fs.promises.readdir.bind(fs.promises);
  t.mock.method(fs.promises, 'readdir', async (candidate: string, ...args: unknown[]) => {
    if (candidate === child) throw Object.assign(new Error('temporary access denied'), { code: 'EACCES' });
    return (readdir as Function)(candidate, ...args);
  });
  const mutations: string[] = [];
  await assert.rejects(syncIndex({
    listDocuments: async () => [source],
    deleteFile: async (name: string) => { mutations.push(name); },
    upsertFile: async (name: string) => { mutations.push(name); return { outcome: 'added' }; },
  } as unknown as Indexer, root), { code: 'EACCES' });
  assert.deepEqual(mutations, []);
});

test('removing many stale projections yields to the event loop between batches', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stashbase-batched-reconcile-'));
  try {
    const stale = Array.from({ length: RECONCILE_BATCH_SIZE * 3 }, (_, i) => path.join(root, `gone-${i}.md`));
    let deleted = 0;
    const observed: number[] = [];
    let finished = false;
    // A macrotask probe stands in for an HTTP handler waiting behind the reconcile.
    const probe = () => {
      observed.push(deleted);
      if (!finished) setImmediate(probe);
    };
    setImmediate(probe);
    const result = await syncIndex({
      listDocuments: async () => stale,
      deleteFile: async () => { deleted += 1; },
      upsertFile: async () => { throw new Error('nothing on disk to offer'); },
    } as unknown as Indexer, root);
    finished = true;
    assert.equal(result.removed.length, stale.length);
    assert.ok(
      observed.some((count) => count > 0 && count < stale.length),
      `the probe never ran mid-reconcile (saw ${observed.join(',')})`,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
