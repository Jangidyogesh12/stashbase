'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { createScheduledTasksPreload } = require('../../dist/electron/scheduled-tasks/preload.cjs');

const request = {
  agent: 'claude',
  files: ['workflows/brief.md'],
  folderPath: '/projects/brief',
  prompt: '',
  requestId: 'request-1',
  runId: 'run-1',
  taskId: 'brief',
  title: 'Daily brief · Oct 16',
};

function fakeIpc(pending = []) {
  const listeners = new Map();
  const invoked = [];
  return {
    invoked,
    push: (channel, payload) => listeners.get(channel)?.({}, payload),
    ipc: {
      on: (channel, listener) => listeners.set(channel, listener),
      async invoke(channel, payload) {
        invoked.push([channel, payload]);
        if (channel === 'scheduled-tasks:run-pending') return pending;
        if (channel === 'scheduled-tasks:run-now') {
          return { ok: true, outcome: { agent: 'claude', sessionId: 'native-1', status: 'sent' } };
        }
        return { ok: true };
      },
    },
  };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('a run that arrives both by push and by the late subscriber’s pull starts once', async () => {
  const fake = fakeIpc([request]);
  const preload = createScheduledTasksPreload(fake.ipc);
  assert.equal(Object.isFrozen(preload), true);
  // Before anyone subscribed, the push is left for the pull to take up.
  fake.push('scheduled-tasks:run-requested', request);
  const started = [];
  preload.onRunRequested(async (run) => {
    started.push(run.requestId);
    return { agent: 'claude', sessionId: 'native-1', status: 'sent' };
  });
  fake.push('scheduled-tasks:run-requested', request);
  await settle();
  await settle();
  assert.deepEqual(started, ['request-1']);
  assert.deepEqual(fake.invoked.filter(([channel]) => channel === 'scheduled-tasks:run-finished'), [
    ['scheduled-tasks:run-finished', {
      outcome: { agent: 'claude', sessionId: 'native-1', status: 'sent' },
      requestId: 'request-1',
    }],
  ]);
});

test('a handler that throws or answers nonsense reports a failed run', async () => {
  const fake = fakeIpc();
  const preload = createScheduledTasksPreload(fake.ipc);
  preload.onRunRequested(async (run) => {
    if (run.requestId === 'request-1') throw new Error('boom');
    return { status: 'sent' };
  });
  fake.push('scheduled-tasks:run-requested', request);
  fake.push('scheduled-tasks:run-requested', { ...request, requestId: 'request-2' });
  fake.push('scheduled-tasks:run-requested', { ...request, requestId: 'request-3', extra: true });
  await settle();
  await settle();
  const finished = fake.invoked.filter(([channel]) => channel === 'scheduled-tasks:run-finished');
  assert.deepEqual(finished.map(([, payload]) => [payload.requestId, payload.outcome.status]), [
    ['request-1', 'failed'],
    ['request-2', 'failed'],
  ]);
  assert.deepEqual(await preload.runNow({ folderPath: '/projects/brief', taskId: 'brief' }), {
    ok: true,
    outcome: { agent: 'claude', sessionId: 'native-1', status: 'sent' },
  });
  assert.equal((await preload.runNow({ folderPath: '', taskId: 'brief' })).ok, false);
});
