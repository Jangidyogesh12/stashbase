const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { test } = require('node:test');
const { attachWindowDiagnostics, attachChildProcessDiagnostics } = require('./lifecycle-diagnostics.cjs');

test('network service exits can be correlated with 1006 even when Electron reports a clean utility exit', () => {
  const app = new EventEmitter();
  const rows = [];
  attachChildProcessDiagnostics(app, { appSessionId: 'app', hostInstanceId: () => 'host', record: (...args) => rows.push(args) });
  for (const reason of ['killed', 'clean-exit']) app.emit('child-process-gone', {}, {
    type: 'Utility', serviceName: 'network.mojom.NetworkService', name: 'localized service name', reason, exitCode: reason === 'killed' ? 9 : 0,
  });
  assert.equal(rows.length, 2);
  assert.ok(rows.every(row => row[2].process === 'network-service' && row[2].stage === 'exit'
    && row[2].host_instance_id === 'host' && row[2].app_session_id === 'app'));
  assert.deepEqual(rows.map(row => row[3]), ['error', 'info']);
  assert.equal(rows[0][0].exitCode, 9);
  assert.doesNotMatch(JSON.stringify(rows), /localized service name/);
});

test('unrecognized utility names are never collected and existing GPU failures remain errors', () => {
  const app = new EventEmitter();
  const rows = [];
  attachChildProcessDiagnostics(app, { appSessionId: 'app', hostInstanceId: () => undefined, record: (...args) => rows.push(args) });
  app.emit('child-process-gone', {}, { type: 'Utility', serviceName: '/private/user-path', reason: 'clean-exit', exitCode: 0 });
  app.emit('child-process-gone', {}, { type: 'GPU', name: '/private/user-path', reason: 'oom', exitCode: 1 });
  assert.equal(rows.length, 1);
  assert.equal(rows[0][2].process, 'GPU');
  assert.doesNotMatch(JSON.stringify(rows), /private|user-path/);
});

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
