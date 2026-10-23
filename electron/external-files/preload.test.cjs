'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createExternalFilesPreload,
} = require('../../dist/electron/external-files/preload.cjs');

const granted = {
  ok: true,
  result: {
    format: 'md',
    kind: 'external',
    name: 'notes.md',
    path: '/Users/reader/Desktop/notes.md',
    token: 'abcdefghijklmnopqrstuvwxyz012345',
  },
};

test('external files preload sends only the path it read off the dropped file', async () => {
  const invocations = [];
  const dropped = { name: 'notes.md' };
  const preload = createExternalFilesPreload(
    {
      invoke: async (channel, payload) => {
        invocations.push([channel, payload]);
        return granted;
      },
    },
    (file) => (file === dropped ? '/Users/reader/Desktop/notes.md' : ''),
  );

  assert.equal(Object.isFrozen(preload), true);
  assert.deepEqual(await preload.open(dropped), granted);
  assert.deepEqual(invocations, [
    ['external-files:open', { path: '/Users/reader/Desktop/notes.md' }],
  ]);
});

test('a file with no location on disk never reaches main', async () => {
  const invocations = [];
  const preload = createExternalFilesPreload(
    { invoke: async (channel, payload) => invocations.push([channel, payload]) },
    () => '',
  );
  assert.equal((await preload.open({ name: 'scripted.md' })).ok, false);
  assert.deepEqual(invocations, []);
});

test('a malformed answer from main reads as unavailable', async () => {
  const preload = createExternalFilesPreload(
    { invoke: async () => ({ ok: true, result: { kind: 'external', path: '../escape' } }) },
    () => '/Users/reader/notes.md',
  );
  assert.equal((await preload.open({})).ok, false);
});
