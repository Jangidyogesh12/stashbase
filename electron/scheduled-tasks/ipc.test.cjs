'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');

const {
  SCHEDULED_TASKS_CAPABILITY,
  createScheduledRunCoordinator,
  registerScheduledTasksIpc,
} = require('../../dist/electron/scheduled-tasks/ipc.cjs');

const run = {
  agent: null,
  files: ['workflows/brief.md'],
  folderPath: '/projects/brief',
  prompt: '',
  runId: 'run-1',
  taskId: 'brief',
  title: 'Daily brief · Oct 16',
};

function windowFixture(id) {
  const frame = { url: 'app://renderer/' };
  const sent = [];
  const window = new EventEmitter();
  window.destroyed = false;
  window.isDestroyed = () => window.destroyed;
  window.webContents = {
    id,
    isDestroyed: () => window.destroyed,
    mainFrame: frame,
    send: (channel, payload) => sent.push([channel, payload]),
  };
  return { event: { sender: window.webContents, senderFrame: frame }, sent, window };
}

test('a run stays claimable until its own window answers it', async () => {
  let ids = 0;
  const runs = createScheduledRunCoordinator({ createRequestId: () => `request-${(ids += 1)}` });
  const project = windowFixture(7);
  const other = windowFixture(8);
  const first = runs.request(project.window, run);
  const second = runs.request(project.window, { ...run, taskId: 'weekly' });

  assert.deepEqual(project.sent.map(([channel, payload]) => [channel, payload.requestId]), [
    ['scheduled-tasks:run-requested', 'request-1'],
    ['scheduled-tasks:run-requested', 'request-2'],
  ]);
  assert.deepEqual(runs.pending(7).map((request) => request.taskId), ['brief', 'weekly']);
  const sent = { outcome: { agent: 'claude', sessionId: 'native-1', status: 'sent' }, requestId: 'request-1' };
  assert.equal(runs.finish(8, sent), false, 'another window cannot answer it');
  assert.equal(runs.finish(7, { ...sent, outcome: { status: 'sent' } }), false, 'a malformed answer is refused');
  assert.equal(runs.finish(7, sent), true);
  assert.equal(runs.finish(7, sent), false, 'a run is answered once');
  assert.deepEqual(await first, sent.outcome);
  assert.deepEqual(runs.pending(7).map((request) => request.taskId), ['weekly']);

  project.window.destroyed = true;
  project.window.emit('closed');
  assert.deepEqual(await second, { reason: 'The project window closed before the chat started.', status: 'failed' });
  assert.deepEqual(runs.pending(7), []);
  assert.deepEqual(runs.pending(other.window.webContents.id), []);
});

test('a window that never answers fails the run after the deadline', async () => {
  const runs = createScheduledRunCoordinator({ timeoutMs: 5 });
  const project = windowFixture(9);
  assert.deepEqual(await runs.request(project.window, run), {
    reason: 'The project window did not start the chat in time.',
    status: 'failed',
  });
});

test('Run now is refused to a window that shows another project', async () => {
  const handlers = new Map();
  const project = windowFixture(3);
  const asked = [];
  registerScheduledTasksIpc({
    BrowserWindow: { fromWebContents: (contents) => (contents === project.window.webContents ? project.window : null) },
    expectedOrigins: new Set(['app://renderer']),
    hasCapability: (_window, capability) => capability === SCHEDULED_TASKS_CAPABILITY,
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    isLiveWindow: () => true,
    runNow: async (_window, folderPath, taskId) => {
      asked.push([folderPath, taskId]);
      return { agent: 'codex', sessionId: 'native-3', status: 'sent' };
    },
    showsFolder: async (_window, folderPath) => folderPath === '/projects/brief',
  });
  const runNow = handlers.get('scheduled-tasks:run-now');
  assert.deepEqual(await runNow(project.event, { folderPath: '/projects/other', taskId: 'brief' }), {
    failure: { kind: 'unauthorized', message: 'This window shows a different project.' },
    ok: false,
  });
  assert.equal((await runNow(project.event, { folderPath: '/projects/brief' })).failure.kind, 'invalid-request');
  assert.deepEqual(await runNow(project.event, { folderPath: '/projects/brief', taskId: 'brief' }), {
    ok: true,
    outcome: { agent: 'codex', sessionId: 'native-3', status: 'sent' },
  });
  assert.deepEqual(asked, [['/projects/brief', 'brief']]);
  const stranger = windowFixture(4);
  assert.equal((await runNow(stranger.event, { folderPath: '/projects/brief', taskId: 'brief' })).failure.kind, 'unauthorized');
});
