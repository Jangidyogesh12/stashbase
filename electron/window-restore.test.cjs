'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createWindowRestoreRecord, foldersToRestore, reopenFolders } = require('./window-restore.cjs');

const A = path.resolve('/projects/a');
const B = path.resolve('/projects/b');
const C = path.resolve('/projects/c');

function fakeWindow(name) {
  return { name, live: true, close() { this.live = false; } };
}

test('the record round-trips the projects to reopen and reads damage as nothing', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stashbase-window-restore-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'window-restore.json');
  const record = createWindowRestoreRecord({ filePath });

  assert.deepEqual(record.read(), []);
  record.write([A, B, A, 'relative/path']);
  assert.deepEqual(createWindowRestoreRecord({ filePath }).read(), [B, A]);

  fs.writeFileSync(filePath, '{not json');
  assert.deepEqual(record.read(), []);
  fs.writeFileSync(filePath, JSON.stringify({ version: 2, folders: [A] }));
  assert.deepEqual(record.read(), []);
});

test('a failed write keeps the previous record', () => {
  const files = new Map([['/data/window-restore.json', JSON.stringify({ version: 1, folders: [A] })]]);
  const record = createWindowRestoreRecord({
    filePath: '/data/window-restore.json',
    fileSystem: {
      readFileSync: (file) => {
        if (!files.has(file)) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
        return files.get(file);
      },
      mkdirSync: () => {},
      writeFileSync: () => { throw new Error('disk full'); },
      renameSync: () => {},
      rmSync: () => {},
    },
  });
  record.write([B]);
  assert.deepEqual(record.read(), [A]);
});

test('open project windows are recorded with the focused one last', () => {
  const [first, second, welcome] = ['first', 'second', 'welcome'].map(fakeWindow);
  const folders = new Map([[first, A], [second, B]]);
  assert.deepEqual(
    foldersToRestore({ windows: [first, second, welcome], folderFor: (win) => folders.get(win), focused: first }),
    [B, A],
  );
});

test('closing a window records the rest, and the last one closed stands in for none', () => {
  const [first, second] = ['first', 'second'].map(fakeWindow);
  const folders = new Map([[first, A], [second, B]]);
  const folderFor = (win) => folders.get(win) ?? null;
  assert.deepEqual(foldersToRestore({ windows: [first, second], folderFor, closing: first }), [B]);
  assert.deepEqual(foldersToRestore({ windows: [second], folderFor, closing: second }), [B]);
  // The last window on Welcome leaves nothing to reopen.
  const welcome = fakeWindow('welcome');
  assert.deepEqual(foldersToRestore({ windows: [welcome], folderFor, closing: welcome }), []);
});

test('a launch reopens each project in its own window, reusing the first', async () => {
  const first = fakeWindow('first');
  const created = [];
  const entered = [];
  const opened = await reopenFolders({
    folders: [A, B],
    firstWindow: first,
    createWindow: async () => {
      const win = fakeWindow(`created-${created.length}`);
      created.push(win);
      return win;
    },
    enterFolder: async (win, folder) => { entered.push([win.name, folder]); },
    isLive: (win) => win.live,
  });
  assert.deepEqual(entered, [['first', A], ['created-0', B]]);
  assert.deepEqual(opened.map((win) => win.name), ['first', 'created-0']);
});

test('a project that cannot be reopened leaves its window for the next, and no extra Welcome window', async () => {
  const first = fakeWindow('first');
  const created = [];
  const failures = [];
  const opened = await reopenFolders({
    folders: [A, B, C],
    firstWindow: first,
    createWindow: async () => {
      const win = fakeWindow(`created-${created.length}`);
      created.push(win);
      return win;
    },
    enterFolder: async (_win, folder) => {
      if (folder !== B) throw new Error(`${folder} is gone`);
    },
    isLive: (win) => win.live,
    onFailure: (folder) => failures.push(folder),
  });
  // A fails in the first window, which then opens B; C fails in a new window,
  // which closes because B is already showing.
  assert.deepEqual(failures, [A, C]);
  assert.deepEqual(opened, [first]);
  assert.equal(created.length, 1);
  assert.equal(created[0].live, false);
  assert.equal(first.live, true);
});

test('when nothing can be reopened the first window stays on Welcome', async () => {
  const first = fakeWindow('first');
  const opened = await reopenFolders({
    folders: [A],
    firstWindow: first,
    createWindow: async () => assert.fail('no window is needed'),
    enterFolder: async () => { throw new Error('gone'); },
    isLive: (win) => win.live,
  });
  assert.deepEqual(opened, []);
  assert.equal(first.live, true);
});
