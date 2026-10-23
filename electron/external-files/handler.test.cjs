'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  EXTERNAL_FILES_CAPABILITY,
  registerExternalFiles,
} = require('../../dist/electron/external-files/handler.cjs');

function harness({ authorized = true, register = async () => null } = {}) {
  const handlers = new Map();
  const frame = { url: 'app://renderer/' };
  const webContents = { mainFrame: frame };
  const window = { isDestroyed: () => false };
  registerExternalFiles({
    BrowserWindow: { fromWebContents: (candidate) => (candidate === webContents ? window : null) },
    expectedOrigins: new Set(['app://renderer']),
    hasCapability: (_window, capability) => authorized && capability === EXTERNAL_FILES_CAPABILITY,
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    isLiveWindow: (candidate) => candidate === window,
    register,
    windowIdFor: (candidate) => (candidate === window ? 'window-1' : null),
  });
  return {
    event: { sender: webContents, senderFrame: frame },
    open: handlers.get('external-files:open'),
  };
}

test('main registers a dropped path for the sending window and relays the result', async () => {
  const registered = [];
  const result = {
    format: 'pdf',
    kind: 'external',
    name: 'paper.pdf',
    path: '/Users/reader/paper.pdf',
    token: 'abcdefghijklmnopqrstuvwxyz012345',
  };
  const setup = harness({
    register: async (windowId, filePath) => {
      registered.push([windowId, filePath]);
      return result;
    },
  });
  assert.deepEqual(await setup.open(setup.event, { path: '/Users/reader/paper.pdf' }), {
    ok: true,
    result,
  });
  assert.deepEqual(registered, [['window-1', '/Users/reader/paper.pdf']]);
});

test('unauthorized senders, relative paths, and malformed server answers register nothing usable', async () => {
  const registered = [];
  const denied = harness({ authorized: false, register: async (...args) => registered.push(args) });
  assert.equal((await denied.open(denied.event, { path: '/Users/reader/notes.md' })).ok, false);
  const setup = harness({ register: async () => ({ kind: 'external' }) });
  assert.equal((await setup.open(setup.event, { path: 'notes.md' })).ok, false);
  assert.equal((await setup.open(setup.event, { path: '/Users/reader/notes.md' })).ok, false);
  assert.deepEqual(registered, []);
});
