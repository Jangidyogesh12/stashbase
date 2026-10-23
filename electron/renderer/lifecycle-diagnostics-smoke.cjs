const assert = require('node:assert/strict');
const path = require('node:path');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');
const { app, BrowserWindow } = require('electron');
const { WebSocketServer } = require('ws');
const { attachWindowDiagnostics } = require('./lifecycle-diagnostics.cjs');
const { createNativeDiagnostics } = require('../../dist/electron/diagnostics/native.cjs');

const root = process.env.STASHBASE_SMOKE_ROOT;
assert.ok(root, 'the smoke runner owns the isolated profile and cleanup');
app.setPath('userData', path.join(root, 'profile'));
app.on('window-all-closed', () => {});

async function run() {
  await app.whenReady();
  const windowId = randomUUID(), hostId = randomUUID();
  // Explicit fixture collector: no network delivery and no real preferences.
  const native = createNativeDiagnostics({ available: true, distribution: 'source', version: 'fixture',
    directory: path.join(root, 'diagnostics'), read: () => ({}) });
  const sockets = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(sockets, 'listening');
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  attachWindowDiagnostics(win, { windowId, appSessionId: randomUUID(), hostInstanceId: () => hostId,
    record: (...args) => native.record(...args), quitting: () => false });
  try {
    await win.loadURL('data:text/html,<title>Lifecycle verification</title><p>Isolated connection fixture</p>');
    const connected = once(sockets, 'connection');
    await win.webContents.executeJavaScript(`window.fixtureSocket = new WebSocket('ws://127.0.0.1:${sockets.address().port}'); void 0`);
    const [peer] = await connected;
    const closed = once(peer, 'close');
    const gone = once(win.webContents, 'render-process-gone');
    // Kill only this fixture's renderer. forcefullyCrashRenderer uses a
    // fatal crash path that can wait for OS core dumping on hosted Linux.
    const rendererPid = win.webContents.getOSProcessId();
    assert.ok(rendererPid > 0 && rendererPid !== process.pid);
    process.kill(rendererPid, 'SIGKILL');
    const [, details] = await gone;
    assert.notEqual(details.reason, 'clean-exit');
    // The separate network service can retain the socket after renderer
    // death on Linux. Release the owning window before awaiting its socket.
    win.destroy();
    const [code] = await closed;
    // Chromium's surviving network service may send Going Away even when
    // the renderer is killed. Correlate the real exit rather than infer it
    // from the socket code; a lost transport instead reports 1006.
    assert.ok(code === 1001 || code === 1006, `unexpected close code: ${code}`);
    const records = [];
    native.drain(record => { records.push(record); return true; });
    assert.deepEqual(records.map(record => record.context.stage).sort(), ['closed', 'exit', 'loaded']);
    assert.ok(records.every(record => record.context.window_id === windowId && record.context.host_instance_id === hostId));
    assert.ok(records.every(record => record.context.pid > 0));
    const exit = records.find(record => record.context.stage === 'exit');
    assert.equal(exit.severity, 'error');
    assert.equal(exit.context.reason, details.reason);
    assert.equal(exit.diagnostic.exit_code, details.exitCode);
    assert.equal(records.find(record => record.context.stage === 'closed').severity, 'info');
    console.log(JSON.stringify({ scenario: 'renderer-crash-correlation', closeCode: code, reason: details.reason, records: records.length, correlated: true }));
  } finally {
    if (!win.isDestroyed()) win.destroy();
    for (const socket of sockets.clients) socket.terminate();
    await new Promise(resolve => sockets.close(resolve));
    native.clear();
  }
}
run().then(() => app.exit(0), error => { console.error(error); app.exit(1); });
