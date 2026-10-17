import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { assertMacosArchitecture, assertMacosReleaseCredentials } from './macos-release-contract.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const afterPack = require('./after-pack-macos.cjs');
const signMacosApp = require('./sign-macos-app.cjs');

function source(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

const apiCredentials = {
  APPLE_API_KEY: '/tmp/AuthKey_TEST.p8',
  APPLE_API_KEY_ID: 'TESTKEY123',
  APPLE_API_ISSUER: '00000000-0000-0000-0000-000000000000',
};
const existingFile = { fileExists: () => true };

test('macOS release credentials fail closed and accept one complete notarization mode', () => {
  assert.throws(
    () => assertMacosReleaseCredentials({ GITHUB_ACTIONS: 'true', ...apiCredentials }, existingFile),
    /CSC_LINK and CSC_KEY_PASSWORD/,
  );
  assert.throws(
    () => assertMacosReleaseCredentials({ APPLE_API_KEY: apiCredentials.APPLE_API_KEY }, existingFile),
    /APPLE_API_KEY_ID, APPLE_API_ISSUER/,
  );
  assert.throws(
    () => assertMacosReleaseCredentials({}, existingFile),
    /exactly one notarization credential set/,
  );
  assert.throws(
    () => assertMacosReleaseCredentials({
      ...apiCredentials,
      APPLE_ID: 'release@example.com',
      APPLE_APP_SPECIFIC_PASSWORD: 'password',
      APPLE_TEAM_ID: 'TEAMID1234',
    }, existingFile),
    /must not configure multiple/,
  );
  assert.equal(
    assertMacosReleaseCredentials({
      GITHUB_ACTIONS: 'true',
      CSC_LINK: 'base64-p12',
      CSC_KEY_PASSWORD: 'password',
      ...apiCredentials,
    }, existingFile),
    'api-key',
  );
  assert.equal(
    assertMacosReleaseCredentials({
      APPLE_ID: 'release@example.com',
      APPLE_APP_SPECIFIC_PASSWORD: 'password',
      APPLE_TEAM_ID: 'TEAMID1234',
    }),
    'apple-id',
  );
  assert.equal(
    assertMacosReleaseCredentials({ APPLE_KEYCHAIN_PROFILE: 'stashbase-notary' }),
    'keychain',
  );
});

test('macOS package configuration requires Developer ID signing and notarization', () => {
  const pkg = JSON.parse(source('package.json'));
  const mac = pkg.build.mac;
  const dmgEntries = pkg.build.dmg.contents.map((entry) => entry.path).filter(Boolean);

  assert.equal(
    Object.hasOwn(pkg.build, 'electronDist'),
    false,
    'release packaging must unpack the official Electron zip so macOS framework symlinks survive',
  );
  assert.equal(Object.hasOwn(mac, 'identity'), false);
  assert.equal(mac.hardenedRuntime, true);
  assert.equal(mac.notarize, false);
  assert.equal(pkg.build.afterSign, 'scripts/notarize-macos.cjs');
  assert.equal(mac.entitlements, 'build/entitlements.mac.plist');
  assert.equal(mac.entitlementsInherit, 'build/entitlements.mac.inherit.plist');
  assert.equal(mac.sign, 'scripts/sign-macos-app.cjs');
  assert.deepEqual(mac.binaries, ['Contents/Resources/opencode/opencode.exe']);
  assert.equal(pkg.build.dmg.sign, false);
  assert.deepEqual(dmgEntries, ['/Applications']);

  for (const entitlements of [
    source('build/entitlements.mac.plist'),
    source('build/entitlements.mac.inherit.plist'),
  ]) {
    assert.match(entitlements, /com\.apple\.security\.cs\.allow-jit/);
    assert.doesNotMatch(entitlements, /allow-unsigned-executable-memory|get-task-allow/);
  }

  const openCodeEntitlements = source('build/entitlements.mac.opencode.plist');
  assert.match(openCodeEntitlements, /com\.apple\.security\.cs\.allow-jit/);
  assert.match(openCodeEntitlements, /com\.apple\.security\.cs\.allow-unsigned-executable-memory/);
  assert.doesNotMatch(openCodeEntitlements, /get-task-allow/);

  const inherited = { entitlements: '/tmp/inherit.plist', hardenedRuntime: true };
  const ordinary = '/tmp/StashBase.app/Contents/Frameworks/StashBase Helper.app';
  const openCode = '/tmp/StashBase.app/Contents/Resources/opencode/opencode.exe';
  assert.equal(signMacosApp.optionsForSignedFile(ordinary, inherited), inherited);
  assert.equal(signMacosApp.isBundledOpenCode('C:\\StashBase.app\\Contents\\Resources\\opencode\\opencode.exe'), true);
  assert.deepEqual(signMacosApp.optionsForSignedFile(openCode, inherited), {
    ...inherited,
    entitlements: path.join(root, 'build', 'entitlements.mac.opencode.plist'),
  });
  const wrappedOptionsForFile = signMacosApp.createOptionsForFile(() => inherited);
  assert.deepEqual(
    wrappedOptionsForFile(openCode),
    signMacosApp.optionsForSignedFile(openCode, inherited),
    'electron-osx-sign consumes optionsForFile synchronously',
  );
});

test('macOS release adapters preserve the final signature and require its verification', () => {
  const packager = source('scripts/package-desktop.mjs');
  assert.match(packager, /--config\.forceCodeSigning=true/);
  assert.doesNotMatch(packager, /CSC_IDENTITY_AUTO_DISCOVERY/);
  assert.doesNotMatch(packager, /clearQuarantine\(\['release\.nosync'/);

  const afterPack = source('scripts/after-pack-macos.cjs');
  assert.match(afterPack, /ditto.*--noextattr/s);
  assert.doesNotMatch(afterPack, /execFileSync\([^\n]+codesign|sign-macos-app|\/bin\/zsh/);

  const workflow = source('.github/workflows/release-macos.yml');
  for (const secret of [
    'MAC_CSC_LINK',
    'MAC_CSC_KEY_PASSWORD',
    'APPLE_API_KEY_P8',
    'APPLE_API_KEY_ID',
    'APPLE_API_ISSUER',
  ]) {
    assert.match(workflow, new RegExp(`secrets\\.${secret}`));
  }
  assert.match(workflow, /base64 -D/);
  assert.match(workflow, /APPLE_API_KEY=.*GITHUB_ENV/);

  const publisher = source('scripts/publish-github-release.mjs');
  assert.match(publisher, /STASHBASE_RELEASE_BUILD = '1'/);
  assert.match(publisher, /release-verify-mac\.mjs/);
  assert.ok(
    publisher.indexOf('release-verify-mac.mjs') < publisher.indexOf('const artifacts = listArtifacts()'),
    'the final macOS artifact must be verified before upload discovery',
  );

  const cask = source('scripts/publish-homebrew.mjs');
  assert.doesNotMatch(cask, /postflight|sign-macos-app|xattr/);

  const verifier = source('scripts/release-verify-mac.mjs');
  assert.match(verifier, /codesign/);
  assert.match(verifier, /allow-unsigned-executable-memory/);
  assert.match(verifier, /spctl/);
  assert.match(verifier, /stapler/);
  assert.match(source('scripts/notarize-macos.cjs'), /notarize\(/);
  assert.match(source('scripts/notarize-macos.cjs'), /stapler\('validate'/);

  for (const removed of [
    'build/dmg-scripts/Fix.sh',
    'build/dmg-scripts/Read Me.txt',
    'scripts/sign-macos-app.sh',
  ]) {
    assert.equal(fs.existsSync(path.join(root, removed)), false, `${removed} must stay retired`);
  }
});

test('macOS afterPack preserves the original CI bundle and rejects flattened framework links', {
  skip: process.platform === 'win32',
}, async () => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'stashbase-after-pack-'));
  const appPath = path.join(output, 'StashBase.app');
  const frameworkPath = path.join(
    appPath,
    'Contents',
    'Frameworks',
    'Electron Framework.framework',
  );
  const versionPath = path.join(frameworkPath, 'Versions', 'A');
  fs.mkdirSync(path.join(versionPath, 'Resources'), { recursive: true });
  fs.writeFileSync(path.join(versionPath, 'Resources', 'Info.plist'), '<plist/>');
  fs.writeFileSync(path.join(versionPath, 'Electron Framework'), 'fixture');
  fs.symlinkSync('A', path.join(frameworkPath, 'Versions', 'Current'));
  fs.symlinkSync(
    'Versions/Current/Electron Framework',
    path.join(frameworkPath, 'Electron Framework'),
  );
  fs.symlinkSync('Versions/Current/Resources', path.join(frameworkPath, 'Resources'));

  const originalInode = fs.statSync(appPath).ino;
  const previousActions = process.env.GITHUB_ACTIONS;
  process.env.GITHUB_ACTIONS = 'true';
  try {
    await afterPack({
      electronPlatformName: 'darwin',
      appOutDir: output,
      packager: { appInfo: { productFilename: 'StashBase' } },
    });
  } finally {
    if (previousActions === undefined) delete process.env.GITHUB_ACTIONS;
    else process.env.GITHUB_ACTIONS = previousActions;
  }
  assert.equal(fs.statSync(appPath).ino, originalInode);

  fs.unlinkSync(path.join(frameworkPath, 'Electron Framework'));
  fs.writeFileSync(path.join(frameworkPath, 'Electron Framework'), 'flattened');
  assert.throws(
    () => afterPack.assertVersionedFrameworkStructure(appPath),
    /must remain a symbolic link before codesign/,
  );
  fs.rmSync(output, { recursive: true, force: true });
});

test('native Mach-O verification accepts the host architecture and rejects a different one', {
  skip: process.platform !== 'darwin',
}, (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'macos-architecture-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const hostArch = process.arch === 'x64' ? 'x86_64' : process.arch;
  const architectures = execFileSync('/usr/bin/lipo', [process.execPath, '-archs'], { encoding: 'utf8' }).trim().split(/\s+/);
  let executable = process.execPath;
  if (architectures.length > 1) {
    executable = path.join(root, 'node');
    execFileSync('/usr/bin/lipo', [process.execPath, '-thin', hostArch, '-output', executable]);
  }
  assert.doesNotThrow(() => assertMacosArchitecture(executable));
  assert.throws(() => assertMacosArchitecture(executable, process.arch === 'arm64' ? 'x64' : 'arm64'));
});
