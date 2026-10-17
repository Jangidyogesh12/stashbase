import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { stringify } from 'yaml';
import { createRequire } from 'node:module';
import { mergeMacArtifacts } from './macos-artifacts.mjs';
import { macCaskContent } from './macos-cask.mjs';

const { MacUpdater } = createRequire(import.meta.url)('electron-updater/out/MacUpdater.js');
const sha = (bytes, algorithm, encoding) => crypto.createHash(algorithm).update(bytes).digest(encoding);

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'macos-artifacts-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const directories = {};
  const metadata = {};
  for (const arch of ['arm64', 'x64']) {
    const directory = directories[arch] = path.join(root, arch);
    await fs.mkdir(directory);
    const files = [];
    for (const ext of ['zip', 'dmg']) {
      const name = `StashBase-3.0.0-mac-${arch}.${ext}`;
      const bytes = Buffer.from(`${arch} ${ext} payload`);
      await fs.writeFile(path.join(directory, name), bytes);
      files.push({ url: name, sha512: sha(bytes, 'sha512', 'base64'), size: bytes.length });
    }
    metadata[arch] = { version: '3.0.0', files, path: files[0].url, sha512: files[0].sha512 };
    await fs.writeFile(path.join(directory, 'latest-mac.yml'), stringify(metadata[arch]));

  }
  return { directories, metadata, output: path.join(root, 'merged'), version: '3.0.0', productName: 'StashBase' };
}

test('merged metadata lets the installed updater select the correct architecture', async (t) => {
  const f = await fixture(t);
  const metadata = await mergeMacArtifacts(f);
  const resolved = metadata.files.map((info) => ({ url: new URL(info.url, 'https://example.test/'), info }));
  for (const [arch, isArm] of [['arm64', true], ['x64', false]]) {
    const files = MacUpdater.filterFilesForArch(resolved, isArm);
    assert.ok(files.some((file) => file.url.pathname.endsWith(`-${arch}.zip`)));
    assert.ok(files.every((file) => file.url.pathname.includes(`-${arch}.`)));
  }
  await assert.rejects(mergeMacArtifacts(f), /EEXIST/);
});

for (const failure of ['missing-architecture', 'wrong-version', 'wrong-architecture', 'corrupt-zip']) {
  test(`combined channel stays absent when ${failure}`, async (t) => {
    const f = await fixture(t);
    const directory = f.directories.x64;
    if (failure === 'missing-architecture') await fs.rm(directory, { recursive: true });
    if (failure === 'wrong-version') f.metadata.x64.version = '2.0.0';
    if (failure === 'wrong-architecture') f.metadata.x64.files = f.metadata.arm64.files;
    if (failure.startsWith('wrong-')) await fs.writeFile(path.join(directory, 'latest-mac.yml'), stringify(f.metadata.x64));
    if (failure === 'corrupt-zip') await fs.writeFile(path.join(directory, 'StashBase-3.0.0-mac-x64.zip'), 'corrupt');
    await assert.rejects(mergeMacArtifacts(f));
    assert.equal(await fs.access(f.output).then(() => true, () => false), false);
  });
}

test('Homebrew selects a checksum and download for each CPU without raising the app OS minimum', () => {
  const args = { cask: 'stashbase', version: '3.0.0', productName: 'StashBase', description: 'Writing IDE',
    repo: 'liliu-z/stashbase', appId: 'com.stashbase.app', checksums: { arm64: 'a'.repeat(64), x64: 'b'.repeat(64) } };
  const content = macCaskContent(args);
  assert.match(content, /arch arm: "arm64", intel: "x64"/);
  assert.ok(content.includes(`sha256 arm: "${args.checksums.arm64}"`));
  assert.ok(content.includes(`intel: "${args.checksums.x64}"`));
  assert.match(content, /mac-#\{arch\}\.dmg/);
  assert.match(content, />= :monterey/);
  assert.throws(() => macCaskContent({ ...args, checksums: { arm64: 'a' } }), /both/);
});
