'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');

const { waitForChildExit } = require('../smoke-process.cjs');

const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
environment.STASHBASE_TELEMETRY_DISABLED = '1';

const electronArguments = [];
// GitHub's Linux hosts cannot install Electron's setuid helper. Local Linux,
// macOS, and Windows retain the process sandbox so this smoke exercises the
// effective BrowserWindow boundary whenever the host supports it.
if (process.platform === 'linux' && environment.CI === 'true') {
  electronArguments.unshift('--no-sandbox');
}

async function run() {
  for (const script of ['smoke.cjs', 'request-authorization-smoke.cjs', 'bug-report-smoke.cjs', '../account/auth-network-smoke.cjs']) {
    const child = spawn(
      require('electron'),
      [...electronArguments, path.join(__dirname, script)],
      {
        cwd: path.resolve(__dirname, '../..'),
        env: environment,
        stdio: 'inherit',
        detached: process.platform !== 'win32',
      },
    );
    await waitForChildExit(child, { launch: script, timeoutMs: 45_000 });
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
