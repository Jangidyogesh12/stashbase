const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { test } = require('node:test');
const { attachWindowDiagnostics } = require('./lifecycle-diagnostics.cjs');

test('window crash and close retain the same window, renderer and host identities', () => {
  const webContents = Object.assign(new EventEmitter(), { id: 12, getOSProcessId: () => 456 });
  const win = Object.assign(new EventEmitter(), { webContents });
  const rows = [];
  let host = 'first-host';
  attachWindowDiagnostics(win, { windowId: 'window', appSessionId: 'app', hostInstanceId: () => host,
    record: (...args) => rows.push(args), quitting: () => false });
  webContents.emit('did-finish-load');
  host = 'second-host';
  webContents.emit('render-process-gone', {}, { reason: 'oom', exitCode: -536870904 });
  // getOSProcessId is no longer safe once the renderer has gone.
  webContents.getOSProcessId = () => { throw new Error('destroyed'); };
  Object.defineProperty(win, 'webContents', { get() { throw new Error('destroyed window'); } });
  win.emit('closed');
  assert.deepEqual(rows.map(row => row[2].stage), ['loaded', 'exit', 'closed']);
  assert.deepEqual(rows.map(row => row[3]), ['info', 'error', 'info']);
  assert.ok(rows.every(row => row[2].window_id === 'window' && row[2].app_session_id === 'app' && row[2].pid === 456));
  assert.equal(rows[1][2].host_instance_id, 'second-host');
  assert.equal(rows[1][0].exitCode, -536870904);
  assert.equal(rows[1][2].reason, 'oom');
});

test('clean renderer exits and app-quit window closure are observations, not errors', () => {
  const webContents = Object.assign(new EventEmitter(), { id: 3, getOSProcessId: () => 0 });
  const win = Object.assign(new EventEmitter(), { webContents });
  const rows = [];
  attachWindowDiagnostics(win, { windowId: 'window', appSessionId: 'app', hostInstanceId: () => undefined,
    record: (...args) => rows.push(args), quitting: () => true });
  webContents.emit('render-process-gone', {}, { reason: 'clean-exit', exitCode: 0 });
  win.emit('closed');
  assert.ok(rows.every(row => row[3] === 'info'));
  assert.equal(rows[1][2].reason, 'app_shutdown');
  assert.equal(rows[1][2].pid, undefined);
});
