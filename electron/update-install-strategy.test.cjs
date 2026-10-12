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
    relaunchAfterServerExit: true,
    requestJson: async () => ({ reachable: true, statusCode: 202 }),
    SERVER_PORT: 8090,
    SERVER_SHUTDOWN_TOKEN: 'test-token',
    process: { exitCode: 0 },
    setTimeout,
    clearTimeout,
  });
  app.emit('will-quit', { preventDefault: () => events.push('wait') });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ['wait']);
  child.exitCode = 0;
  child.emit('exit', 0);
  assert.deepEqual(events, ['wait', 'relaunch', 'exit']);
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
