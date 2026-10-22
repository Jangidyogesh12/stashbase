import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { mirrorRelease, releaseInstallers } from './download-mirror.mjs';

const bytes = Buffer.from('signed installer fixture');
const sha256 = createHash('sha256').update(bytes).digest('hex');
function release() {
  const tag_name = 'v2.16.17';
  return { tag_name, draft: false, prerelease: false, published_at: '2026-10-22T00:00:00Z',
    assets: ['mac-arm64.dmg', 'mac-x64.dmg', 'win-x64.exe', 'linux-amd64.deb', 'linux-x86_64.AppImage'].map((suffix) => {
      const name = `StashBase-${tag_name.slice(1)}-${suffix}`;
      return { name, size: bytes.length, digest: `sha256:${sha256}`,
        browser_download_url: `https://github.com/liliu-z/stashbase/releases/download/${tag_name}/${name}` };
    }),
  };
}
async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'download-mirror-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'installer');
  await writeFile(file, bytes);
  const objects = new Map();
  const events = [];
  return { file, objects, events, options: {
    release: release(), download: async () => file, currentLatestTag: async () => 'v2.16.17',
    store: {
      head: async (key) => objects.get(key),
      putFile: async (asset, _file, digest) => {
        events.push(asset.key);
        objects.set(asset.key, { size: digest.size, sha256: digest.sha256 });
      },
      putManifest: async (manifest) => { events.push('latest.json'); objects.set('latest.json', manifest); },
    },
  } };
}

test('publishes discovery only after all verified installers and retries reuse immutable bytes', async (t) => {
  const f = await fixture(t);
  await mirrorRelease(f.options);
  assert.equal(f.events.length, 6);
  assert.equal(f.events.at(-1), 'latest.json');
  assert.equal(f.objects.get('latest.json').assets.length, 5);
  f.events.length = 0;
  f.options.download = async () => { throw new Error('must reuse uploaded file'); };
  await mirrorRelease(f.options);
  assert.deepEqual(f.events, ['latest.json']);
});

test('corrupt downloads and immutable conflicts cannot advertise a release or overwrite files', async (t) => {
  const f = await fixture(t);
  await writeFile(f.file, 'corrupt');
  await assert.rejects(mirrorRelease(f.options), /checksum mismatch/);
  assert.deepEqual(f.events, []);
  f.objects.set(releaseInstallers(f.options.release)[0].key, { size: bytes.length, sha256: 'wrong' });
  await assert.rejects(mirrorRelease(f.options), /Immutable download conflict/);
  assert.deepEqual(f.events, []);
});

test('an interrupted upload leaves the old manifest and can resume without replacing completed files', async (t) => {
  const f = await fixture(t);
  f.objects.set('latest.json', { tag_name: 'v2.16.16' });
  const put = f.options.store.putFile;
  f.options.store.putFile = async (...args) => {
    if (f.events.length === 2) throw new Error('network failed');
    return put(...args);
  };
  await assert.rejects(mirrorRelease(f.options), /network failed/);
  assert.equal(f.objects.get('latest.json').tag_name, 'v2.16.16');
  f.options.store.putFile = put;
  await mirrorRelease(f.options);
  assert.equal(f.events.length, 6);
  assert.equal(f.objects.get('latest.json').tag_name, 'v2.16.17');
});

test('retrying a previous release never moves latest backwards', async (t) => {
  const f = await fixture(t);
  f.options.currentLatestTag = async () => 'v2.16.18';
  await mirrorRelease(f.options);
  assert.equal(f.events.length, 5);
  assert.equal(f.objects.has('latest.json'), false);
});

test('rejects drafts, prereleases, incomplete releases and untrusted or unverified assets before writing', () => {
  for (const change of [{ draft: true }, { prerelease: true }, { tag_name: '../escape' }, { assets: [] }]) {
    assert.throws(() => releaseInstallers({ ...release(), ...change }));
  }
  for (const change of [{ digest: null }, { size: 0 }, { browser_download_url: 'https://example.com/malware.exe' }]) {
    const r = release();
    Object.assign(r.assets[0], change);
    assert.throws(() => releaseInstallers(r), /unverifiable/);
  }
});
