'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { UPDATES_CAPABILITY, registerUpdatesIpc } = require('../../dist/electron/updates/ipc.cjs');

// The shape `electron/update-manager.cjs` actually publishes: four fields no
// window may see, plus keys carried with the value `undefined`.
const installerState = {
  autoCheckEnabled: true,
  currentVersion: '1.4.2',
  message: 'Update check failed against GitHub.',
  phase: 'idle',
  platform: 'darwin',
  releaseDate: undefined,
  releaseName: undefined,
  releaseUrl: 'https://github.com/liliu-z/stashbase/releases/latest',
  simulation: { enabled: true, value: 'off' },
};

const HIDDEN_FIELDS = ['message', 'platform', 'releaseUrl', 'simulation'];

const idleSnapshot = { autoCheckEnabled: true, currentVersion: '1.4.2', phase: 'idle' };

const unauthorized = { ok: false, failure: { kind: 'unauthorized' } };
const invalidRequest = { ok: false, failure: { kind: 'invalid-request' } };
const failed = { ok: false, failure: { kind: 'failed' } };

function windowFixture(id) {
  const frame = { url: 'app://renderer/' };
  const sent = [];
  const fixture = { capable: true, contentsDestroyed: false, frame, live: true, sent };
  const webContents = {
    id,
    mainFrame: frame,
    isDestroyed: () => fixture.contentsDestroyed,
    send: (channel, payload) => sent.push([channel, payload]),
  };
  fixture.window = { isDestroyed: () => false, webContents };
  fixture.event = { sender: webContents, senderFrame: frame };
  return fixture;
}

function harness({
  debugEnabled = true,
  failing = null,
  simulationPercent = 42.4,
  state = installerState,
  windowCount = 1,
} = {}) {
  const fixtures = Array.from({ length: windowCount }, (_unused, index) => windowFixture(11 + index));
  const handlers = new Map();
  const calls = [];
  const writes = [];
  const current = { state };
  const fixtureFor = (window) => fixtures.find((candidate) => candidate.window === window);
  const answer = (name) => {
    calls.push(name);
    return failing === name
      ? Promise.reject(new Error('the update machine is unavailable'))
      : Promise.resolve(current.state);
  };
  const updates = registerUpdatesIpc({
    BrowserWindow: {
      fromWebContents: (contents) =>
        fixtures.find((candidate) => candidate.window.webContents === contents)?.window ?? null,
    },
    debugEnabled,
    expectedOrigins: new Set(['app://renderer']),
    hasCapability: (window, capability) =>
      capability === UPDATES_CAPABILITY && fixtureFor(window)?.capable === true,
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    isLiveWindow: (window) => fixtureFor(window)?.live === true,
    manager: {
      check: () => answer('check'),
      getState: () => {
        calls.push('getState');
        return current.state;
      },
      openDownloadPage: () => {
        calls.push('openDownloadPage');
        return Promise.resolve(true);
      },
      primaryAction: () => answer('primaryAction'),
      // The real manager re-reads the durable preference here, so the snapshot
      // it returns is the one that reflects the write that just happened.
      refreshPreference: (options) => {
        calls.push(['refreshPreference', options]);
        current.state = { ...current.state, autoCheckEnabled: writes.at(-1) === true };
        return Promise.resolve(current.state);
      },
      setUpdateSimulation: (value) => {
        calls.push(['setUpdateSimulation', value]);
        current.state =
          value === 'off'
            ? { ...installerState }
            : {
                ...installerState,
                availableVersion: '1.4.3',
                percent: simulationPercent,
                phase: value,
              };
        return current.state;
      },
    },
    setAutoCheck: async (enabled) => {
      calls.push(['setAutoCheck', enabled]);
      writes.push(enabled);
    },
    windows: () => fixtures.map((fixture) => fixture.window),
  });
  return { calls, current, fixtures, handlers, updates, writes };
}

test('an authorized read answers the projected snapshot and nothing else', async () => {
  const { calls, fixtures, handlers, updates } = harness();
  const [first] = fixtures;

  const result = await handlers.get('updates:read')(first.event);
  assert.deepEqual(result, { ok: true, snapshot: idleSnapshot });
  assert.deepEqual(Object.keys(result.snapshot).sort(), [
    'autoCheckEnabled',
    'currentVersion',
    'phase',
  ]);
  assert.deepEqual(calls, ['getState']);

  updates.publish(installerState);
  assert.equal(first.sent.length, 1);
  const [channel, payload] = first.sent[0];
  assert.equal(channel, 'updates:snapshot');
  assert.deepEqual(Object.keys(payload).sort(), ['autoCheckEnabled', 'currentVersion', 'phase']);
  for (const hidden of HIDDEN_FIELDS) {
    assert.equal(hidden in result.snapshot, false, `${hidden} must not be answered to a window`);
    assert.equal(hidden in payload, false, `${hidden} must not be pushed to a window`);
  }
});

test('a foreign frame origin is refused on every channel and calls nothing', async () => {
  const { calls, fixtures, handlers, writes } = harness();
  const [first] = fixtures;
  first.frame.url = 'https://example.com/';

  for (const channel of handlers.keys()) {
    assert.deepEqual(
      await handlers.get(channel)(first.event, { enabled: true }),
      unauthorized,
      `${channel} must refuse a foreign origin`,
    );
  }
  assert.deepEqual(calls, []);
  assert.deepEqual(writes, []);
});

test('a window that does not hold the capability is refused, and so is a dead one', async () => {
  const withoutCapability = harness();
  withoutCapability.fixtures[0].capable = false;
  for (const channel of withoutCapability.handlers.keys()) {
    assert.deepEqual(
      await withoutCapability.handlers.get(channel)(withoutCapability.fixtures[0].event, {
        enabled: true,
      }),
      unauthorized,
      `${channel} must refuse a window without ${UPDATES_CAPABILITY}`,
    );
  }
  assert.deepEqual(withoutCapability.calls, []);
  assert.deepEqual(withoutCapability.writes, []);

  const retired = harness();
  retired.fixtures[0].live = false;
  assert.deepEqual(await retired.handlers.get('updates:read')(retired.fixtures[0].event), unauthorized);
  assert.deepEqual(retired.calls, []);
});

test('set-auto-check writes the preference before refreshing from it', async () => {
  const { calls, fixtures, handlers, writes } = harness();

  assert.deepEqual(await handlers.get('updates:set-auto-check')(fixtures[0].event, { enabled: false }), {
    ok: true,
    snapshot: { autoCheckEnabled: false, currentVersion: '1.4.2', phase: 'idle' },
  });
  assert.deepEqual(writes, [false]);
  assert.deepEqual(calls, [
    ['setAutoCheck', false],
    ['refreshPreference', { checkIfEnabled: true }],
  ]);
});

test('a malformed set-auto-check payload writes nothing at all', async () => {
  const { calls, fixtures, handlers, writes } = harness();

  for (const payload of [{ enabled: 'yes' }, { enabled: true, force: true }, {}, undefined, null]) {
    assert.deepEqual(
      await handlers.get('updates:set-auto-check')(fixtures[0].event, payload),
      invalidRequest,
      `${JSON.stringify(payload) ?? 'undefined'} must not be written`,
    );
  }
  assert.deepEqual(writes, []);
  assert.deepEqual(calls, []);
});

test('publish reaches only live capable windows whose contents survive', () => {
  const { fixtures, updates } = harness({ windowCount: 4 });
  const [reachable, retired, withoutCapability, destroyedContents] = fixtures;
  retired.live = false;
  withoutCapability.capable = false;
  destroyedContents.contentsDestroyed = true;

  updates.publish({ ...installerState, availableVersion: '1.4.3', phase: 'available' });

  assert.deepEqual(reachable.sent, [
    [
      'updates:snapshot',
      {
        autoCheckEnabled: true,
        availableVersion: '1.4.3',
        currentVersion: '1.4.2',
        phase: 'available',
      },
    ],
  ]);
  assert.deepEqual([retired.sent, withoutCapability.sent, destroyedContents.sent], [[], [], []]);
});

test('a state the projection cannot describe fails and is never published', async () => {
  const { fixtures, handlers, updates } = harness({ state: { ...installerState, phase: 'ready' } });
  const [first] = fixtures;

  assert.deepEqual(await handlers.get('updates:read')(first.event), failed);

  updates.publish({ ...installerState, percent: 40, phase: 'downloading' });
  updates.publish({ autoCheckEnabled: true, phase: 'idle' });
  updates.publish({ ...installerState, phase: 'nowhere' });
  assert.deepEqual(first.sent, []);
});

test('the simulation channel exists only in a development build', () => {
  const packagedChannels = [
    'updates:check',
    'updates:open-release-page',
    'updates:primary-action',
    'updates:read',
    'updates:set-auto-check',
  ];

  const packaged = harness({ debugEnabled: false });
  assert.equal(packaged.handlers.has('updates:set-simulation'), false);
  assert.deepEqual([...packaged.handlers.keys()].sort(), packagedChannels);

  const development = harness();
  assert.deepEqual(
    [...development.handlers.keys()].sort(),
    [...packagedChannels, 'updates:set-simulation'].sort(),
  );
});

test('the simulation control walks the phase and clamps the reported percent', async () => {
  const rounded = harness({ simulationPercent: 42.4 });
  const downloading = {
    autoCheckEnabled: true,
    availableVersion: '1.4.3',
    currentVersion: '1.4.2',
    percent: 42,
    phase: 'downloading',
  };
  assert.deepEqual(
    await rounded.handlers.get('updates:set-simulation')(rounded.fixtures[0].event, {
      value: 'downloading',
    }),
    { ok: true, snapshot: downloading },
  );
  assert.deepEqual(rounded.calls, [['setUpdateSimulation', 'downloading']]);
  assert.deepEqual(await rounded.handlers.get('updates:read')(rounded.fixtures[0].event), {
    ok: true,
    snapshot: downloading,
  });

  const clamped = harness({ simulationPercent: 140 });
  assert.deepEqual(
    await clamped.handlers.get('updates:set-simulation')(clamped.fixtures[0].event, {
      value: 'downloading',
    }),
    { ok: true, snapshot: { ...downloading, percent: 100 } },
  );

  // `ready` carries no percentage, so the one main holds is dropped here.
  const ready = harness({ simulationPercent: 42.4 });
  assert.deepEqual(
    await ready.handlers.get('updates:set-simulation')(ready.fixtures[0].event, { value: 'ready' }),
    {
      ok: true,
      snapshot: {
        autoCheckEnabled: true,
        availableVersion: '1.4.3',
        currentVersion: '1.4.2',
        phase: 'ready',
      },
    },
  );

  const rejected = harness();
  for (const payload of [{ value: 'nowhere' }, { value: 'ready', force: true }, {}]) {
    assert.deepEqual(
      await rejected.handlers.get('updates:set-simulation')(rejected.fixtures[0].event, payload),
      invalidRequest,
    );
  }
  assert.deepEqual(rejected.calls, []);
});

test('check, the primary action, and the release page answer from the manager', async () => {
  const { calls, fixtures, handlers } = harness();
  const [first] = fixtures;

  assert.deepEqual(await handlers.get('updates:check')(first.event), {
    ok: true,
    snapshot: idleSnapshot,
  });
  assert.deepEqual(await handlers.get('updates:primary-action')(first.event), {
    ok: true,
    snapshot: idleSnapshot,
  });
  assert.deepEqual(await handlers.get('updates:open-release-page')(first.event), {
    ok: true,
    snapshot: idleSnapshot,
  });
  assert.deepEqual(calls, ['check', 'primaryAction', 'openDownloadPage', 'getState']);
});

test('a rejecting manager answers failed rather than throwing across IPC', async () => {
  const { fixtures, handlers } = harness({ failing: 'check' });

  assert.deepEqual(await handlers.get('updates:check')(fixtures[0].event), failed);
  assert.deepEqual(await handlers.get('updates:read')(fixtures[0].event), {
    ok: true,
    snapshot: idleSnapshot,
  });
});

test('projects failed rechecks without exposing native diagnostics or losing the ready version', async () => {
  const { fixtures, handlers } = harness({ state: { ...installerState, phase: 'ready', availableVersion: '2.1.0', checkFailed: true, message: 'private native diagnostic' } });
  const result = await handlers.get('updates:check')(fixtures[0].event);
  assert.equal(result.ok, true);
  assert.equal(result.snapshot.phase, 'ready');
  assert.equal(result.snapshot.checkFailed, true);
  assert.equal(result.snapshot.availableVersion, '2.1.0');
  assert.equal('message' in result.snapshot, false);
});
