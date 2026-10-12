import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildExtractorComponent } from './extractor-component.mjs';
import { createExtractorRuntime } from '../../server/extractor-runtime.ts';

const root = new URL('../../', import.meta.url);

test('the release component manifest drives the runtime through verified installation', async (t) => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'extractor-publish-'));
  t.after(() => fs.rm(tmp, { recursive: true, force: true }));
  const source = path.join(tmp, 'stashbase-extract');
  await fs.mkdir(source);
  const exe = process.platform === 'win32' ? 'stashbase-extract.exe' : 'stashbase-extract';
  await fs.writeFile(path.join(source, exe), 'executable fixture');
  const manifestPath = path.join(tmp, 'resources', 'extractor-runtime.json');
  const built = await buildExtractorComponent({ source, output: path.join(tmp, 'release'), manifestPath, version: '2.0.0' });
  let requests = 0;
  const runtime = createExtractorRuntime({
    root: path.join(tmp, 'installed'), manifest: async () => JSON.parse(await fs.readFile(manifestPath, 'utf8')),
    fetch: async () => { requests++; return new Response(await fs.readFile(built.archive)); },
  });
  const bin = await runtime.ensure();
  assert.equal(await fs.readFile(bin, 'utf8'), 'executable fixture');
  assert.equal(requests, 1);
  assert.equal(await runtime.ensure(), bin);
  // A new application process pins the same independent component and stays
  // usable offline instead of downloading again after an application update.
  const nextApp = createExtractorRuntime({
    root: path.join(tmp, 'installed'), manifest: async () => built.manifest,
    fetch: async () => { throw new Error('offline'); },
  });
  assert.equal(await nextApp.ensure(), bin);
});

test('base package excludes the extractor and development payload, retaining the pinned manifest', async () => {
  const pkg = JSON.parse(await fs.readFile(new URL('package.json', root), 'utf8'));
  const sidecar = pkg.build.extraResources.find((entry) => entry.to === 'python/sidecar');
  assert.deepEqual(sidecar.filter, ['stashbase-daemon/**/*']);
  assert.ok(pkg.build.extraResources.some((entry) => entry.to === 'python/extractor-runtime.json'));
  for (const excluded of ['!**/*.map', '!node_modules/better-sqlite3/deps/**', '!node_modules/better-sqlite3/src/**']) {
    assert.ok(pkg.build.files.includes(excluded));
  }
});

test('macOS component signing rejects unaccepted notarization and requires Developer ID', async (t) => {
  const { signExtractorComponent } = await import('./sign-extractor.mjs');
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'extractor-sign-test-'));
  t.after(() => fs.rm(tmp, { recursive: true, force: true }));
  await fs.writeFile(path.join(tmp, 'stashbase-extract'), Buffer.from('cffaedfe00000000', 'hex'));
  const env = { APPLE_KEYCHAIN_PROFILE: 'fixture-profile' };
  await assert.rejects(signExtractorComponent(tmp, { platform: 'darwin', env, run: () => '' }), /exactly one Developer ID/);
  const commands = [];
  const run = (cmd, args) => {
    commands.push([cmd, args]);
    if (cmd === 'security') return '1) '+ 'A'.repeat(40)+' "Developer ID Application: Fixture"';
    if (cmd === 'xcrun') return JSON.stringify({ id: 'fixture-id', status: 'Invalid' });
    return '';
  };
  await assert.rejects(signExtractorComponent(tmp, { platform: 'darwin', env, run }), /notarization failed/);
  assert.ok(commands.some(([cmd, args]) => cmd === 'codesign' && args.includes('--timestamp')));
  assert.ok(commands.some(([cmd, args]) => cmd === 'codesign' && args.includes('--verify')));
});


test('extractor signing retains codesign diagnostics without leaking credential arguments', async (t) => {
  const { signExtractorComponent } = await import('./sign-extractor.mjs');
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'extractor-sign-diagnostic-'));
  t.after(() => fs.rm(tmp, { recursive: true, force: true }));
  await fs.writeFile(path.join(tmp, 'stashbase-extract'), Buffer.from('cffaedfe00000000', 'hex'));
  const secret = 'fixture-private-password';
  const env = { APPLE_KEYCHAIN_PROFILE: 'fixture-profile', CSC_KEY_PASSWORD: secret, CSC_LINK: 'Zml4dHVyZQ==' };
  const run = (cmd) => {
    if (cmd === 'security') return '1) ' + 'A'.repeat(40) + ' "Developer ID Application: Fixture"';
    throw Object.assign(new Error(`command with ${secret}`), {
      status: 1, stderr: `unable to build chain to self-signed root: ${secret}`,
    });
  };
  await assert.rejects(signExtractorComponent(tmp, { platform: 'darwin', env, run }), (error) => {
    assert.match(error.message, /codesign failed/);
    assert.match(error.message, /unable to build chain/);
    assert.ok(!error.message.includes(secret));
    return true;
  });
});

test('temporary extractor identities join the search list and restore it after signing failure', async (t) => {
  const { signExtractorComponent } = await import('./sign-extractor.mjs');
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'extractor-keychain-test-'));
  t.after(() => fs.rm(tmp, { recursive: true, force: true }));
  await fs.writeFile(path.join(tmp, 'stashbase-extract'), Buffer.from('cffaedfe00000000', 'hex'));
  const original = ['/fixture/login.keychain-db', '/fixture/other identity.keychain-db'];
  let searchList = [...original];
  let keychain;
  let signed = false;
  let deleted = false;
  const run = (cmd, args) => {
    if (cmd === 'security') {
      if (args[0] === 'create-keychain') keychain = args.at(-1);
      if (args[0] === 'list-keychains') {
        if (args.includes('-s')) searchList = args.slice(args.indexOf('-s') + 1);
        return searchList.map((item) => `    "${item}"`).join('\n');
      }
      if (args[0] === 'find-identity') return '1) ' + 'A'.repeat(40) + ' "Developer ID Application: Fixture"';
      if (args[0] === 'delete-keychain') deleted = true;
      return '';
    }
    if (cmd === 'codesign') {
      assert.ok(searchList.includes(keychain), 'codesign must be able to resolve the temporary identity through the search list');
      assert.ok(original.every((item) => searchList.includes(item)));
      signed = true;
    }
    if (cmd === 'xcrun') return JSON.stringify({ id: 'fixture-rejection', status: 'Invalid' });
    return '';
  };
  await assert.rejects(signExtractorComponent(tmp, {
    platform: 'darwin', env: { APPLE_KEYCHAIN_PROFILE: 'fixture-profile', CSC_LINK: 'Zml4dHVyZQ==' }, run,
  }), /notarization failed/);
  assert.equal(signed, true);
  assert.deepEqual(searchList, original);
  assert.equal(deleted, true);
});
