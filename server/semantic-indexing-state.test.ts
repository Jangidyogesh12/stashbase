import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import { syncIndex } from './sync.ts';
import path from 'node:path';
import test from 'node:test';
import {
  cancelFolderSyncsAndWait,
  deleteFolderRuntimeState,
  enqueueFolderSyncOperation,
  getIndexWarning,
  runFolderSyncOperation,
} from './state.ts';
import type { Indexer } from './indexer.ts';
import { filesystemPath } from './filesystem-path.ts';
import { MfsDaemonRetiringError } from './mfs-daemon.ts';

test('Folder sync operations are serialized', async () => {
  const events: string[] = [];
  let releaseOlder!: () => void;
  const olderGate = new Promise<void>((resolve) => { releaseOlder = resolve; });
  const older = enqueueFolderSyncOperation('folder-race', async () => {
    events.push('older-start');
    await olderGate;
    events.push('older-finish');
  });
  const newer = enqueueFolderSyncOperation('folder-race', async () => {
    events.push('newer-start');
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ['older-start']);
  releaseOlder();
  await Promise.all([older, newer]);
  assert.deepEqual(events, ['older-start', 'older-finish', 'newer-start']);
});

test('removing Folder runtime state invalidates an in-flight reconcile', async () => {
  const folder = path.join(os.tmpdir(), 'stashbase-removal-cancels-sync');
  let shouldContinue: (() => boolean) | undefined;
  let releaseSync!: () => void;
  const syncGate = new Promise<void>((resolve) => { releaseSync = resolve; });
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const deps = {
    indexer: {} as Indexer,
    bind: async () => undefined,
    sync: async (_indexer: Indexer, _root: string, options?: { shouldContinue?: () => boolean }) => {
      shouldContinue = options?.shouldContinue;
      markStarted();
      await syncGate;
      throw new Error('MFS daemon closing');
    },
  };
  const running = runFolderSyncOperation(folder, { reason: 'app boot' }, deps);
  let result;
  try {
    await started;
    assert.equal(shouldContinue?.(), true);
    await deleteFolderRuntimeState(folder);
    assert.equal(shouldContinue?.(), false);
  } finally {
    releaseSync();
    result = await running;
  }
  assert.equal(result.cancelled, true);
});

for (const stage of ['upsert', 'delete'] as const) test(`a live Folder reconcile retries daemon retirement during ${stage}`, async (t) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'stashbase-sync-retirement-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const source = path.join(folder, 'note.md');
  fs.writeFileSync(source, 'current source');
  let bindCalls = 0;
  let interrupted = false;
  const interruptOnce = () => { if (!interrupted) { interrupted = true; throw new MfsDaemonRetiringError(); } };
  const result = await runFolderSyncOperation(folder, { reason: 'project reconcile' }, {
    indexer: {
      listDocuments: async () => stage === 'delete' ? [path.join(folder, 'removed.md')] : [],
      deleteFile: async () => interruptOnce(),
      upsertFile: async () => { if (stage === 'upsert') interruptOnce(); return { outcome: 'added' }; },
    } as unknown as Indexer,
    bind: async () => { bindCalls += 1; },
    sync: syncIndex,
  });
  assert.equal(result.cancelled, undefined);
  assert.equal(bindCalls, 2);
  assert.deepEqual(result.failed, []);
  assert.deepEqual(result.added, ['note.md']);
});

test('a Folder reconcile rebinds once when runtime reset drops the binding', async () => {
  const folder = path.join(os.tmpdir(), 'stashbase-live-sync-through-binding-reset');
  let bindCalls = 0;
  let syncCalls = 0;
  const result = await runFolderSyncOperation(folder, { reason: 'runtime reset' }, {
    indexer: {} as Indexer,
    bind: async () => { bindCalls += 1; },
    sync: async () => {
      syncCalls += 1;
      if (syncCalls === 1) return {
        added: [], modified: [], removed: [],
        failed: [{ name: path.join(folder, 'paper.pdf'), error: `no bound root matches path '${path.join(folder, 'paper.pdf')}'; call bind_root first` }],
      };
      return { added: ['paper.pdf'], modified: [], removed: [], failed: [] };
    },
  });
  assert.deepEqual(result.failed, []);
  assert.equal(bindCalls, 2);
  assert.equal(syncCalls, 2);
});

test('a partial Folder reconcile retains its directory warning until a successful retry', async (t) => {
  const folder = path.join(os.tmpdir(), 'stashbase-unreadable-directory-warning');
  t.after(() => deleteFolderRuntimeState(folder));
  const failed = [{ name: 'Library', error: 'Directory could not be read (EACCES). Existing index retained.' }];
  const deps = {
    indexer: {} as Indexer,
    bind: async () => undefined,
    sync: async () => ({ added: ['readable.md'], modified: [], removed: [], failed }),
  };

  const result = await runFolderSyncOperation(folder, { reason: 'manual sync' }, deps);
  assert.deepEqual(result.added, ['readable.md']);
  assert.match(getIndexWarning(folder)?.message ?? '', /file\(s\) or folder\(s\).*Library:.*EACCES.*Existing index retained/);
  assert.equal(getIndexWarning(`${folder}-other`), null);

  failed.length = 0;
  await runFolderSyncOperation(folder, { reason: 'retry' }, deps);
  assert.equal(getIndexWarning(folder), null);
});

test('Folder removal interrupts an unresponsive reconcile before waiting', async () => {
  const folder = path.join(os.tmpdir(), 'stashbase-removal-interrupts-sync');
  let releaseSync!: () => void;
  const syncGate = new Promise<void>((resolve) => { releaseSync = resolve; });
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  let interruptCalls = 0;
  const running = enqueueFolderSyncOperation(filesystemPath.identity(folder), async () => {
    markStarted();
    await syncGate;
  });
  await started;
  const cancellation = cancelFolderSyncsAndWait(folder, async () => {
    interruptCalls += 1;
    releaseSync();
  });
  const settledQuickly = await Promise.race([
    cancellation.then(() => true),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), 50)),
  ]);
  if (!settledQuickly) releaseSync();
  await Promise.allSettled([running, cancellation]);
  assert.equal(settledQuickly, true);
  assert.equal(interruptCalls, 1);
});
