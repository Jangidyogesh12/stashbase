'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { MacUpdater } = require('electron-updater/out/MacUpdater');
const { createUpdateManager } = require('../update-manager.cjs');
const { createUpdateInstaller } = require('../update-install-strategy.cjs');
const { createWindowLifecycleUpdateBarrier } = require('../update-window-barrier.cjs');

/** Real renderer save replies and native window locks, with a controlled
 * Squirrel delay. Never downloads, replaces the app, or quits the test runner. */
async function runUpdateInstallSmoke({ windows, lifecycle, isLiveWindow }) {
  const barrier = createWindowLifecycleUpdateBarrier({
    lifecycle: () => lifecycle, getWindows: () => windows, isLiveWindow,
    onBlocked: () => { throw new Error('built renderers refused the update save'); },
  });
  const native = new EventEmitter();
  let nativeChecks = 0;
  let installs = 0;
  let latest = '2.1.0';
  let downloads = 0;
  let nativeFeed;
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'stashbase-update-recheck-'));
  native.setFeedURL = (feed) => { nativeFeed = feed; };
  native.getFeedURL = () => nativeFeed.url;
  native.checkForUpdates = () => { nativeChecks += 1; };
  native.quitAndInstall = () => {
    assert.ok(windows.every((win) => !win.isEnabled()));
    installs += 1;
  };
  // Run the installed MacUpdater implementation, including its asynchronous
  // Squirrel handoff, on every CI platform without touching a native updater.
  const updater = Object.assign(Object.create(MacUpdater.prototype), {
    nativeUpdater: native, squirrelDownloadedUpdate: false,
    autoRunAppAfterInstall: true,
    _logger: { info() {}, warn() {} },
    async checkForUpdates() {
      this.emit('checking-for-update');
      this.emit('update-available', { version: latest });
    },
    async downloadUpdate() {
      downloads += 1;
      const version = latest;
      const downloadedFile = path.join(fixtureRoot, `${version}.zip`);
      await fs.writeFile(downloadedFile, version);
      return this.updateDownloaded({ url: new URL(`https://example.test/${version}.zip`), info: { size: version.length } }, { version, downloadedFile });
    },
  });
  const manager = createUpdateManager({
    updater, currentVersion: '2.0.0', isPackaged: true,
    readAutoCheck: async () => false,
    beforeInstall: barrier.prepare, afterInstallFailure: barrier.revoke,
    installUpdate: createUpdateInstaller({ updater, platform: 'darwin' }),
  });
  try {
    await manager.start();
    const checkReady = async (version) => {
      await manager.check();
      for (let attempt = 0; attempt < 200 && manager.getState().phase !== 'ready'; attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(manager.getState().phase, 'ready');
      assert.equal(manager.getState().availableVersion, version);
    };
    await checkReady('2.1.0');
    const firstFeed = nativeFeed.url;
    await checkReady('2.1.0');
    assert.equal(downloads, 1);
    assert.equal((await manager.primaryAction()).phase, 'installing');
    updater.emit('error', new Error('controlled native preparation failure'));
    assert.equal(manager.getState().phase, 'error');
    assert.equal(barrier.isActive(), false);
    assert.ok(windows.every((win) => win.isEnabled()));
    native.emit('update-downloaded', {}, '', '', new Date(), `${firstFeed}/old.zip`);
    assert.equal(installs, 0);
    latest = '2.3.0';
    await checkReady('2.3.0');
    assert.equal(downloads, 2);
    assert.notEqual(nativeFeed.url, firstFeed);
    assert.equal(installs, 0);
    assert.equal((await manager.primaryAction()).phase, 'installing');
    assert.equal(nativeChecks, 2);
    assert.equal(installs, 0);
    assert.ok(windows.every((win) => !win.isEnabled()));
    assert.equal(barrier.isActive(), true);
    // The native installer is still waiting after the built renderers saved.
    await new Promise((resolve) => setImmediate(resolve));
    // Read the real MacUpdater loopback handoff. The native installer must
    // receive the replacement bytes, never the first prepared release.
    const feedResponse = await fetch(nativeFeed.url, { headers: nativeFeed.headers });
    assert.equal(feedResponse.status, 200);
    const feed = await feedResponse.json();
    assert.equal(await (await fetch(feed.url)).text(), '2.3.0');
    native.emit('update-downloaded', {}, '', '', new Date(), `${firstFeed}/old.zip`);
    assert.equal(installs, 0);
    native.emit('update-downloaded', {}, '', '', new Date(), feed.url);
    assert.equal(installs, 1);
    updater.emit('error', new Error('controlled install failure'));
    assert.equal(manager.getState().phase, 'error');
    assert.equal(barrier.isActive(), false);
    assert.ok(windows.every((win) => win.isEnabled()));
    console.log('latest-download replacement, real MacUpdater proxy, two-window save, delayed native install, and rollback smoke passed');
  } finally {
    barrier.revoke();
    manager.dispose();
    updater.closeServerIfExists();
    native.removeAllListeners();
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  }
}

module.exports = { runUpdateInstallSmoke };
