const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { createUpdateInstaller } = require('./update-install-strategy.cjs');

class FakeUpdater extends EventEmitter {
  calls = [];
  quitAndInstall(isSilent, isForceRunAfter) {
    this.calls.push([isSilent, isForceRunAfter]);
  }
}

for (const [platform, expected] of [
  ['win32', [true, true]],
  ['darwin', [false, true]],
]) {
  test(`${platform} uses the expected native updater install mode`, () => {
    const updater = new FakeUpdater();
    const install = createUpdateInstaller({
      updater,
      app: { relaunch() {} },
      platform,
      appImagePath: null,
      fileExists: () => true,
    });
    install();
    assert.deepEqual(updater.calls, [expected]);
  });
}

test('Linux deb defers relaunch until the owned server exits', () => {
  const updater = new FakeUpdater();
  const events = [];
  updater.quitAndInstall = function quitAndInstall(isSilent, isForceRunAfter) {
    assert.equal(this.autoRunAppAfterInstall, false);
    this.calls.push([isSilent, isForceRunAfter]);
    events.push('install');
  };
  const install = createUpdateInstaller({
    updater,
    app: { relaunch: () => events.push('relaunch') },
    platform: 'linux',
    appImagePath: null,
    onInstalledWithoutRelaunch: () => events.push('defer-relaunch'),
  });
  install();
  assert.deepEqual(updater.calls, [[false, false]]);
  assert.deepEqual(events, ['install', 'defer-relaunch']);
  assert.equal(updater.listenerCount('error'), 0);
});

test('Linux deb install failure does not schedule a relaunch', () => {
  const updater = new FakeUpdater();
  let deferred = false;
  updater.quitAndInstall = function quitAndInstall() {
    this.emit('error', new Error('package manager refused update'));
  };
  const install = createUpdateInstaller({
    updater,
    platform: 'linux',
    appImagePath: null,
    onInstalledWithoutRelaunch: () => { deferred = true; },
  });
  assert.throws(install, /package manager refused update/);
  assert.equal(deferred, false);
  assert.equal(updater.listenerCount('error'), 0);
});

test('Electron defers the Linux deb relaunch until its server child exits', async () => {
  const source = fs.readFileSync(path.join(__dirname, 'main.cjs'), 'utf8');
  const start = source.indexOf("app.on('before-quit', () => { quitRequested = true; });");
  const end = source.indexOf("app.on('quit', () => {", start);
  assert.ok(start >= 0 && end > start);
  const app = new EventEmitter();
  const child = Object.assign(new EventEmitter(), { exitCode: null, signalCode: null });
  const events = [];
  app.relaunch = () => events.push('relaunch');
  app.exit = () => events.push('exit');
  vm.runInNewContext(source.slice(start, end), {
    app,
    serverProc: child,
    authNetworkBridge: { close: () => events.push('close-auth-network') },
    relaunchAfterServerExit: true,
    desktopUpdates: { getState: () => ({ phase: 'installing' }) },
    requestJson: async (_port, _path, _timeout, options) => {
      assert.equal(options.headers['x-stashbase-shutdown-reason'], 'app_update');
      return { reachable: true, statusCode: 202 };
    },
    SERVER_PORT: 8090,
    SERVER_SHUTDOWN_TOKEN: 'test-token',
    process: { exitCode: 0 },
    setTimeout,
    clearTimeout,
  });
  app.emit('will-quit', { preventDefault: () => events.push('wait') });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ['close-auth-network', 'wait']);
  app.emit('will-quit', { preventDefault: () => events.push('wait-again') });
  child.exitCode = 0;
  child.emit('exit', 0);
  assert.deepEqual(events, ['close-auth-network', 'wait', 'relaunch', 'exit']);
});

test('AppImage applies first and relaunches the final filename after process exit', () => {
  const updater = new FakeUpdater();
  const relaunches = [];
  updater.quitAndInstall = function quitAndInstall(isSilent, isForceRunAfter) {
    this.calls.push([isSilent, isForceRunAfter]);
    this.emit('appimage-filename-updated', '/opt/StashBase-2.1.0.AppImage');
  };
  const install = createUpdateInstaller({
    updater,
    app: { relaunch: (options) => relaunches.push(options) },
    platform: 'linux',
    appImagePath: '/opt/StashBase-2.0.0.AppImage',
    fileExists: (file) => file === '/opt/StashBase-2.1.0.AppImage',
  });

  install();

  assert.deepEqual(updater.calls, [[false, false]]);
  assert.equal(updater.autoRunAppAfterInstall, false);
  assert.deepEqual(relaunches, [{ execPath: '/opt/StashBase-2.1.0.AppImage' }]);
  assert.equal(updater.listenerCount('appimage-filename-updated'), 0);
});

test('AppImage does not schedule a relaunch after a synchronous install error', () => {
  const updater = new FakeUpdater();
  let relaunched = false;
  updater.quitAndInstall = function quitAndInstall() {
    this.emit('error', new Error('install failed'));
  };
  const install = createUpdateInstaller({
    updater,
    app: { relaunch: () => { relaunched = true; } },
    platform: 'linux',
    appImagePath: '/opt/StashBase.AppImage',
    fileExists: () => true,
  });

  assert.throws(install, /install failed/);
  assert.equal(relaunched, false);
});

test('macOS retires failed native callbacks and fetches the replacement even after a stale completion', async () => {
  const { MacUpdater } = require('electron-updater/out/MacUpdater');
  const { createUpdateManager } = require('./update-manager.cjs');
  const native = new EventEmitter();
  let latest = '2.1.0';
  let prepared;
  let nativeTarget;
  const requested = [];
  const installed = [];
  const payloadURL = version => `http://127.0.0.1:${version === '2.1.0' ? 41001 : 41003}/payload.zip`;
  native.getFeedURL = () => new URL('/', payloadURL(prepared)).href;
  native.checkForUpdates = () => requested.push(prepared);
  native.quitAndInstall = () => installed.push(nativeTarget);
  const updater = Object.assign(Object.create(MacUpdater.prototype), {
    nativeUpdater: native, squirrelDownloadedUpdate: false, autoRunAppAfterInstall: true,
    closeServerIfExists() {},
    async checkForUpdates() { this.emit('update-available', { version: latest }); },
    async downloadUpdate() { prepared = latest; this.emit('update-downloaded', { version: latest }); },
  });
  // Preserve the installed dependency's constructor bookkeeping at its native boundary.
  native.on('update-downloaded', () => { updater.squirrelDownloadedUpdate = true; });
  native.on('error', error => updater.emit('error', error));
  const manager = createUpdateManager({
    updater, currentVersion: '2.0.0', isPackaged: true, readAutoCheck: async () => false,
    beforeInstall: async () => true, installUpdate: createUpdateInstaller({ updater, platform: 'darwin' }),
  });
  const check = async () => { await manager.check(); await new Promise(setImmediate); };
  try {
    await check();
    await manager.primaryAction();
    native.emit('error', new Error('native transfer failed'));
    assert.equal(manager.getState().phase, 'error');
    assert.equal(native.listenerCount('update-downloaded'), 1);
    latest = '2.3.0';
    await check();
    nativeTarget = '2.1.0';
    native.emit('update-downloaded', {}, '', '', new Date(), payloadURL(nativeTarget));
    assert.deepEqual(installed, []);
    await manager.primaryAction();
    assert.deepEqual(requested, ['2.1.0', '2.3.0']);
    assert.deepEqual(installed, [], 'the stale Squirrel ready flag cannot install the old payload');
    native.emit('update-downloaded', {}, '', '', new Date(), payloadURL(nativeTarget));
    assert.deepEqual(installed, [], 'late old completion during the replacement attempt is ignored');
    nativeTarget = '2.3.0';
    native.emit('update-downloaded', {}, '', '', new Date(), payloadURL(nativeTarget));
    assert.deepEqual(installed, ['2.3.0']);
    native.emit('update-downloaded', {}, '', '', new Date(), payloadURL(nativeTarget));
    assert.deepEqual(installed, ['2.3.0'], 'completion callbacks are one attempt only');
    assert.equal(native.listenerCount('update-downloaded'), 1);
  } finally { manager.dispose(); }
});
