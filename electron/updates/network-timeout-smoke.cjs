'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createRequire } = require('node:module');
const { createHash } = require('node:crypto');
const { EventEmitter, once } = require('node:events');
const { app } = require('electron');
const { autoUpdater } = require('electron-updater');
const updaterRequire = createRequire(require.resolve('electron-updater'));
const { CancellationToken } = updaterRequire('builder-util-runtime');
const { installUpdateRequestTimeout } = require('./network-timeout.cjs');
const { createUpdateManager } = require('../update-manager.cjs');

const root = process.env.STASHBASE_SMOKE_ROOT;
assert.ok(root, 'the smoke runner owns the isolated profile and cleanup');
require('node:fs').mkdirSync(path.join(root, 'profile'), { recursive: true });
app.setPath('userData', path.join(root, 'profile'));
const payload = Buffer.alloc(12 * 1024, 'update fixture');
const sha512 = createHash('sha512').update(payload).digest('base64');
const idleTimeoutMs = 500;

async function run() {
  await app.whenReady();
  const server = http.createServer((request, response) => {
    if (request.url === '/headers-stall') return;
    if (request.url === '/redirect') {
      response.writeHead(302, { location: '/slow' });
      response.end();
      return;
    }
    response.writeHead(200, { 'content-length': payload.length });
    if (request.url === '/body-stall') {
      response.write(payload.subarray(0, 1024));
      return;
    }
    if (request.url === '/slow') {
      let offset = 0;
      const timer = setInterval(() => {
        response.write(payload.subarray(offset, offset += 1024));
        if (offset >= payload.length) response.end();
      }, 100);
      response.on('close', () => clearInterval(timer));
      return;
    }
    response.end(payload);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const executor = autoUpdater.httpExecutor;
  installUpdateRequestTimeout(executor, { idleTimeoutMs });
  const reports = [];
  let manager;
  let downloadId = 0;
  const download = (route, token = new CancellationToken(), checksum = sha512) => executor.download(
    new URL(`${origin}${route}`), path.join(root, `update-${++downloadId}.bin`), { cancellationToken: token, sha512: checksum },
  );
  try {
    const started = Date.now();
    await assert.rejects(executor.request({ protocol: 'http:', hostname: '127.0.0.1',
      port: server.address().port, path: '/headers-stall', timeout: idleTimeoutMs }), { code: 'ETIMEDOUT' });
    assert.ok(Date.now() - started < 5_000, 'metadata stalls must settle promptly');
    await assert.rejects(download('/body-stall'), { code: 'ETIMEDOUT' });
    const slowStarted = Date.now();
    const downloaded = await download('/redirect');
    assert.ok(Date.now() - slowStarted > idleTimeoutMs, 'continuous progress may exceed the idle deadline');
    assert.deepEqual(await fs.readFile(downloaded), payload);
    await assert.rejects(download('/ok', undefined, Buffer.alloc(64).toString('base64')), /checksum mismatch/i);
    const token = new CancellationToken();
    const pending = download('/headers-stall', token);
    setTimeout(() => token.cancel(), 50);
    await assert.rejects(pending, /cancel/i);

    // Drive the real manager across a failed native download and a fresh retry.
    // Only release discovery and installation are fixtures; bytes use Electron net.
    const updater = new EventEmitter();
    let route = '/body-stall';
    updater.checkForUpdates = async () => { updater.emit('update-available', { version: '9.9.9' }); };
    updater.downloadUpdate = async () => {
      await download(route);
      updater.emit('update-downloaded', { version: '9.9.9' });
    };
    let installs = 0;
    manager = createUpdateManager({ updater, currentVersion: '1.0.0', isPackaged: true,
      readAutoCheck: async () => false, beforeInstall: async () => true,
      installUpdate: () => { installs += 1; }, openReleasePage: async () => {},
      onDiagnostic: (error, context, severity) => reports.push({ error, context, severity }),
    });
    await manager.check();
    await waitFor(() => manager.getState().phase === 'error');
    assert.equal(reports.length, 1);
    assert.equal(reports[0].error.code, 'ETIMEDOUT');
    assert.equal(reports[0].context.stage, 'downloading');
    assert.equal(reports[0].severity, 'error');
    route = '/ok';
    await manager.check();
    await waitFor(() => manager.getState().phase === 'ready');
    assert.equal(installs, 0, 'recovering a download never installs automatically');
    // Let cancelled/completed requests outlive their original deadlines. No late
    // timer may abort the successful retry or change its ready state.
    await new Promise(resolve => setTimeout(resolve, idleTimeoutMs * 2));
    assert.equal(manager.getState().phase, 'ready');
    assert.equal(reports.length, 1);
    console.log(JSON.stringify({ scenario: 'native-update-request-timeout',
      headerStall: 'bounded', bodyStall: 'bounded', slowRedirect: 'complete',
      checksum: 'enforced', cancellation: 'settled', retry: 'ready', installs }));
  } finally {
    manager?.dispose();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

async function waitFor(predicate) {
  const deadline = Date.now() + 5_000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, 'update state did not settle');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

run().then(() => app.exit(0), error => { console.error(error); app.exit(1); });
