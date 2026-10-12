const { randomUUID } = require('node:crypto');

function isCompatibleServerHealth(body, expected) {
  if (!body || typeof body !== 'object') return false;
  if (body.app !== 'stashbase') return false;
  if (body.ok !== true) return false;
  if (body.protocolVersion !== expected.protocolVersion) return false;
  if (body.appRoot !== expected.appRoot) return false;
  if (body.resourcesPath !== expected.resourcesPath) return false;
  if (expected.instanceId !== undefined && body.instanceId !== expected.instanceId) return false;
  return true;
}

/** Build the environment for the Electron-owned server process. Source
 * launches need development runtime behavior even when they serve the built
 * renderer. `STASHBASE_DEV_VITE` is narrower: preserve it only when the caller
 * explicitly knows a Vite renderer is running. Packaged launches inherit
 * neither development mode. */
function createServerChildEnvironment({
  baseEnv,
  packaged,
  packagedEnv,
  shutdownToken,
  oauthReturnToken,
  instanceId,
}) {
  const environment = {
    ...baseEnv,
    ...packagedEnv,
    STASHBASE_SHUTDOWN_TOKEN: shutdownToken,
    STASHBASE_OAUTH_RETURN_TOKEN: oauthReturnToken,
    STASHBASE_SERVER_INSTANCE_ID: instanceId,
  };
  if (packaged) {
    delete environment.STASHBASE_DEV_RUNTIME;
    delete environment.STASHBASE_DEV_VITE;
  } else {
    environment.STASHBASE_DEV_RUNTIME = '1';
  }
  return environment;
}

/** Resolve port ownership before launch, then wait for that launch alone.
 * A watch/shell wrapper may have a different PID from its listener, so the
 * health response carries a non-secret instance ID inherited by the server. */
async function startServer({
  packaged,
  port,
  probe,
  spawn,
  probeOptions,
  timeoutMs = serverStartupTimeoutMs({ packaged }),
  handoffTimeoutMs = 12_000,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  let existing = await waitForStableServerProbe(probe, probeOptions);
  if (existing.compatible && !packaged) return null;
  if (packaged && existing.compatible) {
    // A replacement launch can begin while the prior Electron instance is
    // still waiting for its owned server to finish shutdown. Binding now
    // would fail with EADDRINUSE: the old server has a live parent and must
    // not be reclaimed as an orphan. Wait for the owner to release the port.
    const deadline = now() + handoffTimeoutMs;
    while (existing.occupied && now() < deadline) {
      await sleep(Math.min(150, Math.max(0, deadline - now())));
      existing = await probe();
    }
    if (existing.occupied) {
      throw new Error(
        `Port ${port} is still held by a previous StashBase instance. `
        + 'Quit that instance and reopen StashBase.',
      );
    }
  }
  if (existing.occupied && !existing.compatible && !existing.transient) {
    const what = existing.legacyStashBase ? 'an older StashBase server' : 'another local service';
    throw new Error(
      `Port ${port} is already in use by ${what}, so this StashBase build cannot start its server.\n`
      + `Quit the other StashBase/app using http://127.0.0.1:${port}, then reopen StashBase.`,
    );
  }
  // A persistently unresponsive listener may be a wedged orphan. Let the
  // child arbitrate EADDRINUSE: it alone verifies the entry path and missing
  // parent before reclaiming, and leaves live or foreign listeners alone.
  const instanceId = randomUUID();
  const child = spawn(instanceId);
  let spawnError = null;
  const onError = (error) => { spawnError = error; };
  child.on('error', onError);
  const deadline = now() + timeoutMs;
  try {
    while (now() < deadline) {
      const health = await probe(instanceId);
      if (spawnError) throw new Error(`server spawn failed: ${spawnError.message}`);
      if (child.exitCode != null || child.signalCode != null) {
        const detail = child.exitCode != null
          ? `server exited with code ${child.exitCode}`
          : `server exited with signal ${child.signalCode}`;
        throw new Error(`${detail} before reporting healthy on :${port}`);
      }
      if (health.compatible) return child;
      await sleep(Math.min(150, Math.max(0, deadline - now())));
    }
    throw new Error(`server did not come up on :${port} within ${timeoutMs / 1000}s`);
  } finally {
    child.removeListener('error', onError);
  }
}

/** Keep the Electron-owned process single-layered unless the caller is an
 * explicit Vite development session. A watch wrapper can outlive or orphan
 * its actual listener during Electron shutdown, while a direct source launch
 * needs one child whose exit is the server lifecycle boundary. */
function createServerArguments({ entry, portArgs, packaged, vite }) {
  if (packaged) return [entry, ...portArgs];
  return vite ? ['watch', entry, ...portArgs] : [entry, ...portArgs];
}

/** Source launches compile the TypeScript server on demand, so their first
 * process can legitimately take longer on a cold or contended machine than
 * the pre-bundled packaged entry. Keep packaged startup failure fast while
 * giving source launches a separate bounded readiness budget. */
function serverStartupTimeoutMs({ packaged }) {
  return packaged ? 10_000 : 30_000;
}

/** A listener that accepted the TCP connection but did not finish the health
 * response may be a StashBase server restarting or briefly contended. Do not
 * race a second server onto its port after one short health timeout. Re-probe
 * for a bounded interval; responsive incompatible services still fail fast. */
async function waitForStableServerProbe(probe, options = {}) {
  const timeoutMs = options.timeoutMs ?? 5_000;
  const retryMs = options.retryMs ?? 150;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const deadline = now() + timeoutMs;

  let result = await probe();
  while (result?.transient === true && now() < deadline) {
    await sleep(Math.min(retryMs, deadline - now()));
    result = await probe();
  }
  return result;
}

module.exports = {
  createServerArguments,
  createServerChildEnvironment,
  isCompatibleServerHealth,
  serverStartupTimeoutMs,
  startServer,
  waitForStableServerProbe,
};
