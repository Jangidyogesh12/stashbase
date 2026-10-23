import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { flipFuses } from '@electron/fuses';

const require = createRequire(import.meta.url);
const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
require('electron-builder'); // initialize the public entry before its circular packager modules
const { PlatformPackager } = require(require.resolve('app-builder-lib/out/platformPackager.js', {
  paths: [require.resolve('electron-builder')],
}));

// Run under the existing native Electron smoke (Xvfb on Linux CI). Mutate only
// a disposable runtime copy; never the installed Electron or a release artifact.
test('packaging blocks Electron inspect entry while preserving the Node service runtime', { timeout: 90_000 }, async (t) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'stashbase-fuses-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const installed = require('electron');
  const source = process.platform === 'darwin'
    ? path.resolve(installed, '../../..')
    : path.dirname(installed);
  const copy = path.join(temporary, process.platform === 'darwin' ? 'Electron.app' : 'runtime');
  fs.cpSync(source, copy, { recursive: true, verbatimSymlinks: true });
  if (process.platform === 'darwin') {
    // npm's extracted runtime can flatten framework symlinks. Restore them only
    // in this disposable fixture so the changed binary can be ad-hoc signed.
    // Production packaging uses the official zip and rejects flattened links.
    const frameworks = path.join(copy, 'Contents', 'Frameworks');
    for (const name of fs.readdirSync(frameworks).filter((name) => name.endsWith('.framework'))) {
      const framework = path.join(frameworks, name);
      const current = path.join(framework, 'Versions', 'Current');
      if (fs.lstatSync(current).isSymbolicLink()) continue;
      assert.ok(fs.statSync(path.join(framework, 'Versions', 'A')).isDirectory());
      fs.rmSync(current, { recursive: true });
      fs.symlinkSync('A', current);
      for (const entry of fs.readdirSync(framework).filter((entry) => entry !== 'Versions')) {
        fs.rmSync(path.join(framework, entry), { recursive: true });
        fs.symlinkSync(`Versions/Current/${entry}`, path.join(framework, entry));
      }
    }
  }
  const executable = path.join(copy, path.relative(source, installed));
  const home = path.join(temporary, 'home');
  fs.mkdirSync(home);
  const environment = {
    ...process.env, HOME: home, USERPROFILE: home,
    APPDATA: home, LOCALAPPDATA: home, XDG_CONFIG_HOME: home, XDG_DATA_HOME: home,
    STASHBASE_TELEMETRY_DISABLED: '1',
  };
  for (const name of ['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'NODE_EXTRA_CA_CERTS']) delete environment[name];
  const entry = path.join(temporary, 'probe.cjs');
  fs.writeFileSync(entry, `
    const { app } = require('electron');
    app.setPath('userData', ${JSON.stringify(home)});
    app.whenReady().then(() => {
      console.log('FUSE_PROBE ' + JSON.stringify({ inspector: Boolean(require('node:inspector').url()) }));
      app.quit();
    });
  `);
  const browserArgs = process.platform === 'linux' && process.env.CI === 'true' ? ['--no-sandbox'] : [];
  const probe = async (args, env = environment) => {
    const { stdout } = await run(executable, args, { env, timeout: 20_000, maxBuffer: 1024 * 1024 });
    const result = stdout.split(/\r?\n/).find((line) => line.startsWith('FUSE_PROBE '));
    assert.ok(result, `probe did not complete: ${stdout}`);
    return JSON.parse(result.slice('FUSE_PROBE '.length));
  };
  const apply = async (configuration) => {
    // Exercise electron-builder's actual config mapping as well as the binary.
    const fuseConfig = PlatformPackager.prototype.generateFuseConfig(configuration);
    await flipFuses(process.platform === 'darwin' ? copy : executable, {
      ...fuseConfig, resetAdHocDarwinSignature: process.platform === 'darwin',
    });
  };

  await apply({ ...pkg.build.electronFuses, enableNodeCliInspectArguments: true });
  assert.equal((await probe([...browserArgs, '--inspect=127.0.0.1:0', entry])).inspector, true,
    'positive control must demonstrate a working inspector');

  await apply(pkg.build.electronFuses);
  for (const flag of ['--inspect=127.0.0.1:0', '--inspect-brk=127.0.0.1:0']) {
    assert.equal((await probe([...browserArgs, flag, entry])).inspector, false,
      `${flag} must neither open an Electron inspector nor block startup`);
  }
  const node = await probe(['-e', `console.log('FUSE_PROBE ' + JSON.stringify({
    electron: process.versions.electron, headerSize: require('node:http').maxHeaderSize
  }))`], { ...environment, ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '--max-http-header-size=32768' });
  assert.ok(node.electron, 'the service must run in the packaged Electron Node runtime');
  assert.equal(node.headerSize, 32768, 'retained Node environment options must remain effective');
});
