import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import {
  buildIndexStatus,
  conversionProgressForFolder,
  conversionVersionsForFolder,
  readIndexerStatusForFolder,
  semanticIndexingState,
} from './index-status.ts';
import { beginProjectFolderRemovalAsync } from './folder.ts';
import { clearRecord, markCancelled, markFailed, readAll } from './conversion-status.ts';
import { indexer } from './state.ts';

test('status polling preserves preparation records through unreadable ancestry until absence is confirmed', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stashbase-status-permission-'));
  const child = path.join(root, 'Library');
  const cancelled = path.join(child, 'cancelled.pdf');
  const failed = path.join(child, 'failed.pdf');
  fs.mkdirSync(child);
  fs.writeFileSync(cancelled, 'source fixture');
  fs.writeFileSync(failed, 'source fixture');
  t.after(() => {
    clearRecord(cancelled);
    clearRecord(failed);
    fs.rmSync(root, { recursive: true, force: true });
  });
  markCancelled(cancelled);
  markFailed(failed, 'Preparation failed before access was lost');
  const saved = readAll();
  t.mock.method(indexer, 'status', async () => ({
    total: 0, indexed: 0, pendingCount: 0, pending: [], orphanedCount: 0,
    orphaned: [], upToDate: true, indexReady: true,
  }));
  const stat = fs.statSync;
  const exists = fs.existsSync;
  let denied: string | null = 'EACCES';
  const isDenied = (candidate: unknown) => denied && String(candidate).startsWith(`${child}${path.sep}`);
  t.mock.method(fs, 'statSync', ((candidate: fs.PathLike, ...args: unknown[]) => {
    if (isDenied(candidate)) throw Object.assign(new Error('unreadable ancestor'), { code: denied });
    return Reflect.apply(stat, fs, [candidate, ...args]);
  }) as typeof fs.statSync);
  // existsSync collapses these same filesystem failures to false. This keeps
  // the regression faithful to both the old probe and the explicit stat probe.
  t.mock.method(fs, 'existsSync', (candidate: fs.PathLike) => isDenied(candidate) ? false : exists(candidate));

  for (const code of ['EACCES', 'EPERM', 'EIO']) {
    denied = code;
    const status = await buildIndexStatus(root);
    assert.deepEqual(status.preparationFailures.map((entry) => [entry.path, entry.status]), [
      ['Library/cancelled.pdf', 'cancelled'], ['Library/failed.pdf', 'failed'],
    ], code);
    assert.deepEqual(readAll()[cancelled], saved[cancelled], code);
    assert.deepEqual(readAll()[failed], saved[failed], code);
  }
  denied = null;
  assert.equal((await buildIndexStatus(root)).preparationFailures.length, 2);
  assert.deepEqual(readAll()[cancelled], saved[cancelled]);
  assert.deepEqual(readAll()[failed], saved[failed]);

  fs.unlinkSync(cancelled);
  assert.deepEqual((await buildIndexStatus(root)).preparationFailures.map((entry) => entry.path), ['Library/failed.pdf']);
  assert.equal(readAll()[cancelled], undefined, 'ENOENT confirms the source is gone');
  fs.rmSync(child, { recursive: true });
  fs.writeFileSync(child, 'the former directory is now a file');
  assert.deepEqual((await buildIndexStatus(root)).preparationFailures, []);
  assert.equal(readAll()[failed], undefined, 'ENOTDIR confirms the former child cannot exist');
});

test('index status conversion maps are scoped and folder-relative', () => {
  const root = path.resolve('/tmp/stashbase-index-status');
  const inside = path.join(root, 'docs', 'paper.pdf');
  const outside = path.resolve('/tmp/other/paper.pdf');
  const snapshot = {
    revision: 7,
    tasks: [
      { key: inside, state: 'queued', lane: 'heavy', tasksAhead: 2 },
      { key: path.join(root, 'recordings', 'meeting.wav'), state: 'yielded', lane: 'heavy', tasksAhead: 1 },
      { key: outside, state: 'queued', lane: 'heavy', tasksAhead: 0 },
    ],
    versions: {
      [inside]: 11,
      [outside]: 99,
    },
  };

  assert.deepEqual(conversionProgressForFolder(root, snapshot as any), {
    'docs/paper.pdf': { phase: 'queued', lane: 'heavy', tasksAhead: 2 },
    'recordings/meeting.wav': { phase: 'yielded', lane: 'heavy', tasksAhead: 1 },
  });
  assert.deepEqual(conversionVersionsForFolder(root, snapshot as any), {
    'docs/paper.pdf': 11,
  });
});

test('semantic status distinguishes disabled, indexing, partial, ready, and failed', () => {
  assert.equal(semanticIndexingState({ enabled: false, indexed: 0, pending: 3, failed: false }), 'disabled');
  assert.equal(semanticIndexingState({ enabled: true, indexed: 0, pending: 3, failed: false }), 'indexing');
  assert.equal(semanticIndexingState({ enabled: true, indexed: 2, pending: 3, failed: false }), 'partial-indexing');
  assert.equal(semanticIndexingState({ enabled: true, indexed: 2, pending: 0, failed: false }), 'ready');
  assert.equal(semanticIndexingState({ enabled: true, indexed: 2, pending: 0, failed: true }), 'failed');
});

test('index status treats a daemon interruption during folder removal as transitional', async () => {
  const root = path.resolve('/tmp/stashbase-index-status-removal');
  const finishRemoval = await beginProjectFolderRemovalAsync(root);
  try {
    const status = await readIndexerStatusForFolder(root, async () => {
      throw new Error('MFS daemon closing');
    });
    assert.deepEqual(status, {
      total: 0,
      indexed: 0,
      pendingCount: 0,
      pending: [],
      orphanedCount: 0,
      orphaned: [],
      upToDate: false,
      indexReady: false,
    });
  } finally {
    finishRemoval();
  }
});
