const assert = require('node:assert/strict');
const test = require('node:test');
const { createNotificationSettings } = require('../../dist/electron/notifications/system-settings.cjs');

test('opens only fixed destinations on macOS, Windows, GNOME and KDE, with manual fallback', async () => {
  for (const [platform, desktop, installed, expected] of [
    ['darwin', '', [], ['url', 'x-apple.systempreferences:com.apple.Notifications-Settings.extension']],
    ['win32', '', [], ['url', 'ms-settings:notifications']],
    ['linux', 'ubuntu:GNOME', ['/usr/bin/gnome-control-center'], ['process', '/usr/bin/gnome-control-center', ['notifications']]],
    ['linux', 'KDE', ['/usr/bin/systemsettings'], ['process', '/usr/bin/systemsettings', ['kcm_notifications']]],
    ['linux', 'KDE', ['/usr/bin/systemsettings5'], ['process', '/usr/bin/systemsettings5', ['kcm_notifications']]],
    ['linux', 'GNOME', [], null],
    ['linux', 'XFCE', ['/usr/bin/gnome-control-center'], null],
  ]) {
    const calls = [];
    const settings = createNotificationSettings({ platform, desktop,
      executable: (path) => installed.includes(path),
      openExternal: async (url) => { calls.push(['url', url]); },
      launch: async (path, args) => { calls.push(['process', path, args]); },
    });
    if (expected) {
      await settings.openSettings();
      assert.deepEqual(calls, [expected]);
    } else {
      assert.equal(settings.settingsTarget(), 'manual');
      await assert.rejects(settings.openSettings(), /manually/);
      assert.deepEqual(calls, []);
    }
  }
});

test('launcher failures propagate; a missing Linux settings app falls back on the next read', async () => {
  let installed = true;
  const settings = createNotificationSettings({ platform: 'linux', desktop: 'GNOME', executable: () => installed,
    openExternal: async () => { throw new Error('Unexpected URL'); },
    launch: async () => { throw new Error('Launch failed'); },
  });
  await assert.rejects(settings.openSettings(), /Launch failed/);
  installed = false;
  assert.equal(settings.settingsTarget(), 'manual');
  const mac = createNotificationSettings({ platform: 'darwin', desktop: '', openExternal: async () => { throw new Error('URL handler failed'); } });
  await assert.rejects(mac.openSettings(), /URL handler failed/);
});
