'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const {
  createServerArguments,
  isCompatibleServerHealth,
  startServer,
  createServerChildEnvironment,
  waitForStableServerProbe,
  serverStartupTimeoutMs,
} = require('./main-probe.cjs');

const identity = { protocolVersion: 1, appRoot: '/app', resourcesPath: '/resources' };
const health = (instanceId) => ({ app: 'stashbase', ok: true, ...identity, instanceId });

function startupFixture({ existing, afterSpawn, packaged = true } = {}) {
  let now = 0;
  let spawnedId;
  let probesAfterSpawn = 0;
  const child = Object.assign(new EventEmitter(), { pid: 42, exitCode: null, signalCode: null });
  const options = {
    packaged,
    port: 8090,
    timeoutMs: 500,
    now: () => now,
    sleep: async (ms) => { now += ms; },
    probeOptions: {
      timeoutMs: 500,
      retryMs: 100,
      now: () => now,
      sleep: async (ms) => { now += ms; },
    },
    probe: async (instanceId) => {
      if (instanceId === undefined) return existing ?? { compatible: false, occupied: false };
      probesAfterSpawn += 1;
      const body = afterSpawn
        ? await afterSpawn({ instanceId, child, probe: probesAfterSpawn })
        : health(instanceId);
      return { compatible: isCompatibleServerHealth(body, { ...identity, instanceId }) };
    },
    spawn: (instanceId) => {
      spawnedId = instanceId;
      return child;
    },
  };
  return { options, child, spawnedId: () => spawnedId, elapsed: () => now, probes: () => probesAfterSpawn };
}

test('packaged relaunch waits for the previous server to release the port before spawning', async () => {
  const fixture = startupFixture({
    existing: { compatible: true, occupied: true },
    afterSpawn: ({ instanceId }) => health(instanceId),
  });
  let oldProbes = 0;
  fixture.options.probe = async (instanceId) => {
    if (instanceId === undefined) {
      oldProbes += 1;
      return oldProbes < 3
        ? { compatible: true, occupied: true }
        : { compatible: false, occupied: false };
    }
    assert.equal(oldProbes, 3, 'new server must not bind while the old one owns the port');
    return { compatible: isCompatibleServerHealth(health(instanceId), { ...identity, instanceId }) };
  };
  assert.equal(await startServer(fixture.options), fixture.child);
  assert.equal(oldProbes, 3);
  assert.ok(fixture.spawnedId());
});

test('a permanently unresponsive listener reaches child-side reclaim only after the bounded re-probe', async () => {
  const fixture = startupFixture({ existing: { compatible: false, occupied: true, transient: true } });
  assert.equal(await startServer(fixture.options), fixture.child);
  assert.equal(fixture.elapsed(), 500);
});

test('a responsive foreign listener is rejected without spawning', async () => {
  const fixture = startupFixture({ existing: { compatible: false, occupied: true, transient: false } });
  await assert.rejects(startServer(fixture.options), /another local service/);
  assert.equal(fixture.spawnedId(), undefined);
});

test('an incompatible legacy StashBase listener keeps the port guidance', async () => {
  const fixture = startupFixture({ existing: { compatible: false, occupied: true, legacyStashBase: true } });
  await assert.rejects(startServer(fixture.options), /an older StashBase server/);
  assert.equal(fixture.spawnedId(), undefined);
});

test('only source launches reuse a compatible server without launching a child', async () => {
  const fixture = startupFixture({ packaged: false, existing: { compatible: true, occupied: true } });
  assert.equal(await startServer(fixture.options), null);
  assert.equal(fixture.spawnedId(), undefined);
});

test('source readiness follows the instance ID even when a watch wrapper has a different PID', async () => {
  const fixture = startupFixture({
    packaged: false,
    afterSpawn: ({ instanceId, child }) => ({ ...health(instanceId), pid: child.pid + 1 }),
  });
  assert.equal(await startServer(fixture.options), fixture.child);
});

test('a previous live StashBase server cannot trigger a competing packaged bind', async () => {
  const fixture = startupFixture({
    existing: { compatible: true, occupied: true },
  });
  await assert.rejects(startServer({ ...fixture.options, handoffTimeoutMs: 300 }), /previous StashBase instance/);
  assert.equal(fixture.spawnedId(), undefined);
});

test('a child that exits during a health request never becomes ready', async () => {
  const fixture = startupFixture({
    afterSpawn: ({ child, instanceId }) => { child.signalCode = 'SIGTERM'; return health(instanceId); },
  });
  await assert.rejects(startServer(fixture.options), /exited with signal SIGTERM/);
});

test('spawn failures reject with the cause and release the readiness listener', async () => {
  const fixture = startupFixture({
    afterSpawn: ({ child }) => { child.emit('error', new Error('ENOENT')); return null; },
  });
  await assert.rejects(startServer(fixture.options), /server spawn failed: ENOENT/);
  assert.equal(fixture.child.listenerCount('error'), 0);
});

test('readiness times out when only a prior instance answers', async () => {
  const fixture = startupFixture({ afterSpawn: () => health('old-instance') });
  await assert.rejects(startServer(fixture.options), /did not come up/);
  assert.equal(fixture.elapsed(), 500);
  assert.equal(fixture.child.listenerCount('error'), 0);
});

test('child environment replaces inherited instance identity and health rejects missing ownership', () => {
  const environment = createServerChildEnvironment({
    baseEnv: { STASHBASE_SERVER_INSTANCE_ID: 'old-instance' },
    packaged: true,
    instanceId: 'new-instance',
  });
  assert.equal(environment.STASHBASE_SERVER_INSTANCE_ID, 'new-instance');
  assert.equal(isCompatibleServerHealth(health(), identity), true);
  assert.equal(isCompatibleServerHealth(health(), { ...identity, instanceId: 'new-instance' }), false);
});

test('Electron-owned source server does not enable the Vite proxy without an inherited Vite marker', () => {
  const environment = createServerChildEnvironment({
    baseEnv: { PATH: '/test/bin' },
    packaged: false,
    packagedEnv: { STASHBASE_APP_ROOT: '/repo' },
    shutdownToken: 'shutdown-token',
    oauthReturnToken: 'oauth-token',
  });

  assert.equal(environment.STASHBASE_DEV_RUNTIME, '1');
  assert.equal(environment.STASHBASE_DEV_VITE, undefined);
  assert.equal(environment.STASHBASE_APP_ROOT, '/repo');
  assert.equal(environment.STASHBASE_SHUTDOWN_TOKEN, 'shutdown-token');
  assert.equal(environment.STASHBASE_OAUTH_RETURN_TOKEN, 'oauth-token');
});

test('Electron-owned source server preserves an explicit Vite proxy marker', () => {
  const environment = createServerChildEnvironment({
    baseEnv: { STASHBASE_DEV_VITE: '1' },
    packaged: false,
    packagedEnv: { STASHBASE_APP_ROOT: '/repo' },
    shutdownToken: 'shutdown-token',
    oauthReturnToken: 'oauth-token',
  });

  assert.equal(environment.STASHBASE_DEV_RUNTIME, '1');
  assert.equal(environment.STASHBASE_DEV_VITE, '1');
});

test('packaged server environment cannot inherit development runtime flags', () => {
  const environment = createServerChildEnvironment({
    baseEnv: {
      STASHBASE_DEV_RUNTIME: '1',
      STASHBASE_DEV_VITE: '1',
    },
    packaged: true,
    packagedEnv: { ELECTRON_RUN_AS_NODE: '1' },
    shutdownToken: 'shutdown-token',
    oauthReturnToken: 'oauth-token',
  });

  assert.equal(environment.STASHBASE_DEV_RUNTIME, undefined);
  assert.equal(environment.STASHBASE_DEV_VITE, undefined);
  assert.equal(environment.ELECTRON_RUN_AS_NODE, '1');
});

test('Electron-owned server uses a single process unless Vite explicitly needs watch mode', () => {
  const direct = createServerArguments({
    entry: '/repo/server/index.ts',
    portArgs: ['--port=4200'],
    packaged: false,
    vite: false,
  });
  const vite = createServerArguments({
    entry: '/repo/server/index.ts',
    portArgs: ['--port=4200'],
    packaged: false,
    vite: true,
  });
  const packaged = createServerArguments({
    entry: '/app/dist/server/index.mjs',
    portArgs: [],
    packaged: true,
    vite: false,
  });

  assert.deepEqual(direct, ['/repo/server/index.ts', '--port=4200']);
  assert.deepEqual(vite, ['watch', '/repo/server/index.ts', '--port=4200']);
  assert.deepEqual(packaged, ['/app/dist/server/index.mjs']);
});

test('source server startup covers cold TypeScript loading without weakening packaged failure bounds', () => {
  assert.equal(serverStartupTimeoutMs({ packaged: false }), 30_000);
  assert.equal(serverStartupTimeoutMs({ packaged: true }), 10_000);
});

test('Electron waits through a temporarily unresponsive server instead of spawning a competitor', async () => {
  const probes = [
    { compatible: false, occupied: true, transient: true },
    { compatible: false, occupied: true, transient: true },
    { compatible: true, occupied: true, transient: false },
  ];
  let now = 0;
  let waits = 0;

  const result = await waitForStableServerProbe(
    async () => probes.shift(),
    {
      timeoutMs: 1_000,
      retryMs: 100,
      now: () => now,
      sleep: async (ms) => { now += ms; waits += 1; },
    },
  );

  assert.equal(result.compatible, true);
  assert.equal(waits, 2);
});

test('Electron stops waiting when the transient port holder exits', async () => {
  const probes = [
    { compatible: false, occupied: true, transient: true },
    { compatible: false, occupied: false, transient: false },
  ];
  let now = 0;

  const result = await waitForStableServerProbe(
    async () => probes.shift(),
    {
      timeoutMs: 1_000,
      retryMs: 100,
      now: () => now,
      sleep: async (ms) => { now += ms; },
    },
  );

  assert.equal(result.occupied, false, 'Electron may now start the one owned server');
});

test('Electron does not delay a responsive incompatible service', async () => {
  let probes = 0;
  let waits = 0;
  const result = await waitForStableServerProbe(
    async () => {
      probes += 1;
      return { compatible: false, occupied: true, transient: false };
    },
    {
      timeoutMs: 1_000,
      retryMs: 100,
      sleep: async () => { waits += 1; },
    },
  );

  assert.equal(result.compatible, false);
  assert.equal(probes, 1);
  assert.equal(waits, 0);
});
