const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const { createNotificationsPreload } = require('../../dist/electron/notifications/preload.cjs');

test('validates incoming navigation and unsubscribes exactly its listener', async () => {
  const ipc = new EventEmitter();
  const calls = [];
  ipc.invoke = async (...args) => { calls.push(args); return { enabled: true, categories: { 'agent-confirmation': true, 'agent-completed': true, 'agent-failed': true }, supported: true, delivery: 'unknown' }; };
  const bridge = createNotificationsPreload(ipc);
  const targets = [];
  const stop = bridge.onActivate((target) => targets.push(target));
  ipc.emit('notifications:activate', {}, { kind: 'agent-confirmation', id: 'a', allow: true });
  ipc.emit('notifications:activate', {}, { kind: 'agent-confirmation', id: 'a' });
  assert.equal(targets.length, 1);
  stop();
  assert.equal(ipc.listenerCount('notifications:activate'), 0);
  await assert.rejects(bridge.sync({ kind: 'unknown', events: [] }));
  assert.equal(calls.length, 0);
  assert.equal((await bridge.setEnabled(false)).supported, true);
  assert.deepEqual(calls[0], ['notifications:set-enabled', { enabled: false }]);
});
