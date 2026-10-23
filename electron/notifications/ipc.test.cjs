const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { registerNotifications } = require('../../dist/electron/notifications/ipc.cjs');

const request = (id = 'one') => ({ kind: 'agent-confirmation', id: JSON.stringify(['chat', id]), project: 'Research', conversation: 'Draft' });
function harness(t, { corrupt = false, openSettings = async () => {}, supported = () => true, indicators } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stashbase-notifications-'));
  const filePath = path.join(directory, 'notifications.json');
  if (corrupt) fs.writeFileSync(filePath, 'broken');
  const handlers = new Map();
  const notices = [];
  const windows = [];
  let focused = false;
  const service = registerNotifications({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) }, filePath,
    BrowserWindow: { fromWebContents: (contents) => windows.find((win) => win.webContents === contents) },
    expectedOrigins: new Set(['app://renderer']),
    isLiveWindow: (win) => !win.destroyed,
    hasCapability: (win) => win.capable,
    supported,
    settingsTarget: () => 'macos',
    openSettings,
    indicators,
    isAppFocused: () => focused,
    createNotification: (options) => {
      const notice = new EventEmitter();
      Object.assign(notice, { options, closed: false, show() { this.emit('show'); }, close() { this.closed = true; } });
      notices.push(notice);
      return notice;
    },
  });
  const addWindow = () => {
    const win = new EventEmitter();
    const contents = new EventEmitter();
    const frame = { url: 'app://renderer/' };
    Object.assign(contents, { mainFrame: frame, send: (channel, value) => win.sent.push([channel, value]) });
    Object.assign(win, {
      id: windows.length + 1, capable: true, destroyed: false, sent: [], webContents: contents,
      isDestroyed: () => win.destroyed, isMinimized: () => true,
      restore: () => { win.restored = true; }, show: () => { win.shown = true; },
      focus: () => { focused = true; win.emit('focus'); },
    });
    windows.push(win);
    return win;
  };
  const win = addWindow();
  const invoke = (name, payload, target = win, frame = target.webContents.mainFrame) =>
    handlers.get(`notifications:${name}`)({ sender: target.webContents, senderFrame: frame }, name === 'sync' && Array.isArray(payload) ? { kind: 'agent-confirmation', events: payload } : payload);
  t.after(() => { service.dispose(); fs.rmSync(directory, { recursive: true, force: true }); });
  return { win, addWindow, invoke, notices, filePath, tick: () => t.mock.timers.tick(350), foreground(value) { focused = value; } };
}

test('coalesces requests, suppresses repeats and foreground alerts, returns to the owning window', (t) => {
  const h = harness(t);
  h.foreground(true);
  h.invoke('sync', [request()]); h.tick();
  assert.equal(h.notices.length, 0);
  h.foreground(false); h.win.emit('blur');
  h.invoke('sync', [request(), request('two')]); h.tick();
  assert.equal(h.notices.length, 1);
  assert.match(h.notices[0].options.body, /2 requests/);
  h.invoke('sync', [request(), request('two')]); h.tick();
  assert.equal(h.notices.length, 1);
  h.notices[0].emit('click');
  assert.equal(h.win.restored, true);
  assert.deepEqual(h.win.sent.at(-1), ['notifications:activate', { kind: 'agent-confirmation', id: request().id }]);
  assert.equal(h.notices[0].closed, true);
  h.foreground(false); h.win.emit('blur'); h.tick();
  assert.equal(h.notices.length, 1);
});

test('resolution, navigation and renderer loss retire click authority and scheduled alerts', (t) => {
  const h = harness(t);
  h.invoke('sync', [request()]); h.tick();
  const first = h.notices[0];
  h.invoke('sync', []); first.emit('click'); h.tick();
  assert.equal(first.closed, true);
  assert.equal(h.win.sent.some(([channel]) => channel === 'notifications:activate'), false);
  h.invoke('sync', [request('two')]);
  h.win.webContents.emit('render-process-gone'); h.tick();
  assert.equal(h.notices.length, 1);
  h.invoke('sync', [request('three')]); h.tick();
  h.win.webContents.emit('did-start-navigation', {}, 'app://renderer/', false, true);
  h.notices.at(-1).emit('click');
  assert.equal(h.win.sent.some(([channel]) => channel === 'notifications:activate'), false);
});

test('an old replaced notice cannot navigate, and windows cannot cancel each other', (t) => {
  const h = harness(t);
  const other = h.addWindow();
  h.invoke('sync', [request()]); h.tick();
  const stale = h.notices[0];
  h.invoke('sync', [request(), request('two')]); h.tick();
  stale.emit('click');
  assert.equal(h.win.shown, undefined);
  h.invoke('sync', [request()], other); h.tick();
  h.invoke('sync', []);
  assert.equal(h.notices.at(-1).closed, false);
  h.notices.at(-1).emit('click');
  assert.equal(other.shown, true);
  assert.equal(h.win.shown, undefined);
});

test('opt out is durable, shared and closes pending notices; re-enable retains deduplication', (t) => {
  const h = harness(t);
  const other = h.addWindow();
  h.invoke('read', undefined, other);
  h.invoke('sync', [request()]); h.tick();
  h.invoke('set-enabled', { enabled: false });
  assert.equal(JSON.parse(fs.readFileSync(h.filePath, 'utf8')).enabled, false);
  assert.equal(other.sent.at(-1)[1].enabled, false);
  assert.equal(h.notices[0].closed, true);
  h.invoke('sync', [request(), request('two')]); h.tick();
  assert.equal(h.notices.length, 1);
  h.invoke('set-enabled', { enabled: true }); h.tick();
  assert.equal(h.notices.length, 2);
});

test('a new chat alert opens the conversation named in its body, not an older pending chat', (t) => {
  const h = harness(t);
  h.invoke('sync', [request()]); h.tick();
  const next = { ...request('two'), id: JSON.stringify(['second-chat', 'two']), conversation: 'Second draft' };
  h.invoke('sync', [request(), next]); h.tick();
  assert.match(h.notices[1].options.body, /Second draft/);
  h.notices[1].emit('click');
  assert.deepEqual(h.win.sent.at(-1), ['notifications:activate', { kind: 'agent-confirmation', id: next.id }]);
});

test('rejects subframes, foreign origins, missing capability and arbitrary payloads', (t) => {
  const h = harness(t);
  assert.throws(() => h.invoke('sync', [request()], h.win, { url: 'app://renderer/' }));
  h.win.webContents.mainFrame.url = 'https://evil.example';
  assert.throws(() => h.invoke('read'));
  h.win.webContents.mainFrame.url = 'app://renderer/'; h.win.capable = false;
  assert.throws(() => h.invoke('read'));
  h.win.capable = true;
  assert.throws(() => h.invoke('sync', [{ ...request(), command: 'do something' }]));
  assert.throws(() => h.invoke('set-enabled', { enabled: 'yes' }));
});

test('unreadable preferences are neither enabled nor overwritten, delivery failures are visible', (t) => {
  const h = harness(t, { corrupt: true });
  assert.throws(() => h.invoke('read'));
  assert.throws(() => h.invoke('set-enabled', { enabled: true }));
  h.invoke('sync', [request()]); h.tick();
  assert.equal(h.notices.length, 0);
  assert.equal(fs.readFileSync(h.filePath, 'utf8'), 'broken');
});

test('failed delivery is reported and closing the window retires its notification', (t) => {
  const h = harness(t);
  h.invoke('sync', [request()]); h.tick();
  h.notices[0].emit('failed', {}, 'blocked');
  assert.equal(h.invoke('read').delivery, 'failed');
  h.win.destroyed = true; h.win.emit('closed');
  h.notices[0].emit('click');
  assert.equal(h.notices[0].closed, true);
  assert.equal(h.win.shown, undefined);
});

test('category changes are isolated, persisted, shared, and revoke only their native targets', (t) => {
  const h = harness(t);
  const peer = h.addWindow();
  h.invoke('read', undefined, peer);
  const completed = { ...request('done'), kind: 'agent-completed' };
  const failed = { ...request('failed'), kind: 'agent-failed' };
  h.invoke('sync', { kind: completed.kind, events: [completed] });
  h.invoke('sync', { kind: failed.kind, events: [failed] });
  h.tick();
  assert.match(h.notices[0].options.title, /finished/);
  assert.match(h.notices[1].options.title, /did not finish/);
  h.invoke('set-enabled', { kind: 'agent-completed', enabled: false });
  assert.equal(h.notices[0].closed, true);
  assert.equal(h.notices[1].closed, false);
  const preferences = JSON.parse(fs.readFileSync(h.filePath, 'utf8'));
  assert.equal(preferences.enabled, true);
  assert.deepEqual(preferences.categories, { 'agent-confirmation': true, 'agent-completed': false, 'agent-failed': true });
  assert.deepEqual(peer.sent.at(-1)[1].categories, preferences.categories);
  h.notices[0].emit('click');
  assert.equal(h.win.shown, undefined);
  h.notices[1].emit('click');
  assert.deepEqual(h.win.sent.at(-1), ['notifications:activate', { kind: failed.kind, id: failed.id }]);
  assert.throws(() => h.invoke('set-enabled', { kind: 'unknown', enabled: true }));
});

test('foreground and disabled outcomes are consumed, while pending approvals can wait for background', (t) => {
  const h = harness(t);
  const sync = (kind, id) => h.invoke('sync', { kind, events: [{ ...request(id), kind }] });
  h.foreground(true);
  sync('agent-completed', 'foreground');
  sync('agent-confirmation', 'pending');
  // Background before the coalescing timer still cannot replay a foreground result.
  h.foreground(false); h.win.emit('blur'); h.tick();
  assert.equal(h.notices.length, 1);
  assert.match(h.notices[0].options.title, /approval/);
  h.invoke('set-enabled', { kind: 'agent-failed', enabled: false });
  sync('agent-failed', 'disabled'); h.tick();
  h.invoke('set-enabled', { kind: 'agent-failed', enabled: true }); h.tick();
  assert.equal(h.notices.length, 1);
  sync('agent-failed', 'new-failure'); h.tick();
  assert.equal(h.notices.length, 2);
  h.invoke('set-enabled', { enabled: false });
  sync('agent-completed', 'master-disabled'); h.tick();
  h.invoke('set-enabled', { enabled: true }); h.tick();
  assert.equal(h.notices.length, 2);
});

test('settings launch is authorized, takes no destination, and focus refreshes availability without granting permission', async (t) => {
  let available = true;
  let opens = 0;
  const h = harness(t, { supported: () => available, openSettings: async () => { opens++; throw new Error('Cannot open settings'); } });
  assert.throws(() => h.invoke('open-settings', undefined, h.win, { url: 'app://renderer/' }));
  assert.throws(() => h.invoke('open-settings', { url: 'https://evil.example' }));
  h.win.capable = false;
  assert.throws(() => h.invoke('open-settings'));
  assert.equal(opens, 0);
  h.win.capable = true;
  await assert.rejects(h.invoke('open-settings'), /Cannot open settings/);
  assert.equal(opens, 1);
  available = false;
  h.win.emit('focus');
  assert.deepEqual(h.win.sent.at(-1), ['notifications:changed', {
    enabled: true, categories: { 'agent-confirmation': true, 'agent-completed': true, 'agent-failed': true },
    supported: false, settingsTarget: 'macos', delivery: 'unknown',
  }]);
  assert.equal(h.notices.length, 0, 'returning to the app never sends a notification or replays an outcome');
});

test('tray sessions stay live with alerts off; badge state follows background notices and owner focus', (t) => {
  let latest;
  const h = harness(t, { indicators: { update: (snapshot) => { latest = snapshot; }, dispose() {} } });
  const peer = h.addWindow();
  const session = { id: 'chat', project: 'Research', conversation: 'Draft', state: 'working', detail: 'Working…' };
  h.invoke('activity', [session]);
  h.invoke('activity', [{ ...session, state: 'waiting', detail: 'Waiting for approval' }], peer);
  assert.equal(latest.sections[0].items.length, 2);
  assert.notEqual(latest.sections[0].items[0].id, latest.sections[0].items[1].id);
  h.invoke('set-enabled', { enabled: false });
  assert.equal(latest.sections[0].items.length, 2, 'notification opt-out must not hide session activity');
  h.invoke('set-enabled', { enabled: true });
  h.invoke('sync', [request()]);
  h.invoke('sync', { kind: 'agent-completed', events: [{ ...request('done'), kind: 'agent-completed' }] }, peer);
  h.tick(); assert.equal(latest.unread, 2);
  h.win.emit('focus');
  assert.equal(latest.unread, 2, 'pending request remains and another window cannot read a result');
  latest.sections[0].items.find((entry) => entry.id === JSON.stringify([peer.id, 'chat'])).open();
  assert.equal(latest.unread, 1, 'opening the result window acknowledges its background outcome');
  assert.deepEqual(peer.sent.at(-1), ['notifications:open-session', { id: 'chat' }]);
  const stale = latest.sections[0].items[0];
  h.invoke('activity', []);
  stale.open();
  assert.equal(h.win.shown, undefined);
  h.invoke('sync', []);
  assert.equal(latest.unread, 0);
  h.win.capable = false;
  assert.throws(() => h.invoke('activity', [session]));
  peer.webContents.emit('render-process-gone');
  assert.equal(latest.sections[0].items.length, 0);
});
