'use strict';

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
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
  const fuses = spawn(process.execPath, ['--test', 'scripts/packaging/electron-fuses.test.mjs'], {
    cwd: path.resolve(__dirname, '../..'), env: environment, stdio: 'inherit',
    detached: process.platform !== 'win32',
  });
  await waitForChildExit(fuses, { launch: 'Electron fuse behavior', timeoutMs: 100_000 });
  for (const script of ['smoke.cjs', 'lifecycle-diagnostics-smoke.cjs', 'request-authorization-smoke.cjs', 'bug-report-smoke.cjs', '../account/auth-network-smoke.cjs', '../updates/network-timeout-smoke.cjs']) {
    // Chromium keeps cache handles open until Electron exits, especially on
    // Windows. The parent owns fixture cleanup after the child is gone.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stashbase-electron-smoke-'));
    try {
      if (script === 'lifecycle-diagnostics-smoke.cjs') {
        require('esbuild').buildSync({
          entryPoints: [path.resolve(__dirname, '../../renderer/src/features/agent/infrastructure/session-api.ts')],
          outfile: path.join(root, 'session-api.js'), bundle: true, platform: 'browser', format: 'iife', globalName: 'FixtureSession',
          tsconfig: path.resolve(__dirname, '../../renderer/tsconfig.json'),
        });
        require('esbuild').buildSync({
          entryPoints: [path.resolve(__dirname, '../../shared/agent-protocol.ts')],
          outfile: path.join(root, 'agent-protocol.cjs'), bundle: true, platform: 'node', format: 'cjs',
        });
      }
      const child = spawn(
        require('electron'),
        [...electronArguments, path.join(__dirname, script)],
        {
          cwd: path.resolve(__dirname, '../..'),
          env: { ...environment, STASHBASE_SMOKE_ROOT: root },
          stdio: 'inherit',
          detached: process.platform !== 'win32',
        },
      );
      await waitForChildExit(child, { launch: script, timeoutMs: 45_000 });
    } finally {
      await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    }
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
