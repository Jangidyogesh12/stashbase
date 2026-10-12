import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertMacosArchitecture } from './macos-release-contract.mjs';
import appleTicket from './apple-ticket.cjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const releaseDir = path.join(root, 'release.nosync');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const productName = pkg.build?.productName || pkg.name;
const args = new Set(process.argv.slice(2));
const skipBuild = args.has('--skip-build');
const skipSmoke = args.has('--skip-smoke');

if (process.platform !== 'darwin') {
  throw new Error('release:verify:mac must run on macOS.');
}

// Verify the lean installer together with its independently published extractor.
process.env.STASHBASE_RELEASE_BUILD = '1';

function run(command, args, options = {}) {
  console.log(`[release:verify:mac] ${command} ${args.join(' ')}`);
  execFileSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
    ...options,
  });
}

function findDmg() {
  const files = fs.existsSync(releaseDir) ? fs.readdirSync(releaseDir) : [];
  const dmgs = files
    .filter((name) => name === `${productName}-${pkg.version}-mac-${process.arch}.dmg`)
    .sort()
    .map((name) => path.join(releaseDir, name));
  if (dmgs.length !== 1) {
    throw new Error(
      `Expected exactly one ${pkg.version} DMG in ${releaseDir}, found ${dmgs.length}:\n` +
        dmgs.map((file) => `  ${path.basename(file)}`).join('\n'),
    );
  }
  return dmgs[0];
}

function assertPath(target, label) {
  if (!fs.existsSync(target)) throw new Error(`DMG is missing ${label}: ${target}`);
}

function signedEntitlements(executable) {
  const result = spawnSync('/usr/bin/codesign', ['-d', '--entitlements', ':-', executable], {
    cwd: root,
    encoding: 'utf8',
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(`Could not read signed entitlements for ${executable}:\n${result.stderr}`);
  }
  return `${result.stdout}\n${result.stderr}`;
}

function verifyOpenCodeEntitlements(appPath) {
  const appExecutable = path.join(appPath, 'Contents', 'MacOS', productName);
  const openCodeExecutable = path.join(appPath, 'Contents', 'Resources', 'opencode', 'opencode.exe');
  assertPath(openCodeExecutable, 'bundled OpenCode runtime');
  const entitlement = 'com.apple.security.cs.allow-unsigned-executable-memory';
  if (!signedEntitlements(openCodeExecutable).includes(entitlement)) {
    throw new Error(`Bundled OpenCode is missing ${entitlement}.`);
  }
  if (signedEntitlements(appExecutable).includes(entitlement)) {
    throw new Error(`${entitlement} must stay scoped to bundled OpenCode.`);
  }
}

async function verifyMountedDmg(dmg) {
  const mountPoint = fs.mkdtempSync(path.join(os.tmpdir(), 'stashbase-dmg-verify-'));
  let attached = false;
  try {
    run('hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mountPoint, dmg]);
    attached = true;
    const appPath = path.join(mountPoint, `${productName}.app`);
    assertPath(appPath, `${productName}.app`);
    assertPath(path.join(mountPoint, 'Applications'), 'Applications link');
    for (const relative of [
      `Contents/MacOS/${productName}`,
      'Contents/Resources/opencode/opencode.exe',
      'Contents/Resources/python/sidecar/stashbase-daemon/stashbase-daemon',
    ]) {
      assertMacosArchitecture(path.join(appPath, relative));
    }
    run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath]);
    verifyOpenCodeEntitlements(appPath);
    run('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=2', appPath]);
    await appleTicket.stapler('validate', appPath);
    console.log(`[release:verify:mac] verified signed and notarized app in ${path.basename(dmg)}`);
  } finally {
    if (attached) {
      run('hdiutil', ['detach', mountPoint]);
    }
    fs.rmSync(mountPoint, { recursive: true, force: true });
  }
}

if (!skipBuild) run(process.execPath, ['scripts/package-desktop.mjs']);
if (!skipSmoke) run(process.execPath, ['scripts/smoke-packaged-server.mjs']);
await verifyMountedDmg(findDmg());
console.log('[release:verify:mac] ok');
