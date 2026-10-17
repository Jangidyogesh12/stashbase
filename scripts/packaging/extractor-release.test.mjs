import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { parse, stringify } from 'yaml';
import { extractorVersion, extractorInputs, extractorTargets, componentAssetNames, assertComponentRelease, verifyExtractorArchive } from './extractor-release.mjs';
import { buildExtractorComponent } from './extractor-component.mjs';

const root = path.resolve(import.meta.dirname, '../..');

test('component identity changes with native inputs and locked archive dependencies, not the app or renderer', async () => {
  const contents = Object.fromEntries(await Promise.all([...extractorInputs, 'pnpm-lock.yaml']
    .map(async (file) => [file, await fs.readFile(path.join(root, file), 'utf8')])));
  const version = await extractorVersion(root, async (file) => contents[file]);
  for (const file of extractorInputs) {
    assert.notEqual(await extractorVersion(root, async (name) => contents[name] + (name === file ? '\nchanged' : '')), version, file);
  }
  const lock = parse(contents['pnpm-lock.yaml']);
  lock.importers['.'].devDependencies.typescript.version = '999.0.0';
  assert.equal(await extractorVersion(root, async (file) => file === 'pnpm-lock.yaml' ? stringify(lock) : contents[file]), version);
  lock.packages['tar@7.5.22'].resolution.integrity = 'different reviewed bytes';
  assert.notEqual(await extractorVersion(root, async (file) => file === 'pnpm-lock.yaml' ? stringify(lock) : contents[file]), version);
  assert.equal(await extractorVersion(root, async (file) => contents[file].replaceAll('\n', '\r\n')), version);
});

test('reuse refuses drafts, stable releases and incomplete or conflicting component sets', () => {
  const version = '0.0.0-extractor.fixture';
  const release = { tag_name: `v${version}`, draft: false, prerelease: true,
    assets: componentAssetNames(version).map((name) => ({ name, size: 10, state: 'uploaded' })) };
  assert.doesNotThrow(() => assertComponentRelease(release, version));
  for (const patch of [{ draft: true }, { prerelease: false }, { tag_name: 'v2.0.0' },
    { assets: release.assets.slice(1) }, { assets: [...release.assets, release.assets[0]] },
    { assets: release.assets.map((asset) => ({ ...asset, state: 'starter' })) }]) {
    assert.throws(() => assertComponentRelease({ ...release, ...patch }, version));
  }
});

test('packaging verifies independently versioned component identity and bytes before embedding its manifest', async (t) => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'component-inputs-'));
  t.after(() => fs.rm(tmp, { recursive: true, force: true }));
  const source = path.join(tmp, 'stashbase-extract');
  await fs.mkdir(source);
  await fs.writeFile(path.join(source, 'stashbase-extract'), 'fixture');
  const version = '0.0.0-extractor.fixture';
  const { manifest, archive } = await buildExtractorComponent({ source, output: tmp,
    manifestPath: path.join(tmp, 'manifest.json'), version, platform: 'darwin', arch: 'arm64' });
  assert.deepEqual((await verifyExtractorArchive(tmp, version, 'darwin', 'arm64')).manifest, manifest);
  const publishedManifest = archive.replace(/\.tar\.gz$/, '.json');
  await fs.writeFile(publishedManifest, JSON.stringify({ ...manifest, arch: 'x64' }));
  await assert.rejects(verifyExtractorArchive(tmp, version, 'darwin', 'arm64'), /does not match/);
  await fs.writeFile(publishedManifest, JSON.stringify(manifest));
  await fs.appendFile(archive, 'corrupted');
  await assert.rejects(verifyExtractorArchive(tmp, version, 'darwin', 'arm64'), /archive does not match/);
});

test('the release CLI reuses public components and never embeds or publishes corrupt downloads', async (t) => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'component-release-cli-'));
  t.after(() => fs.rm(tmp, { recursive: true, force: true }));
  for (const file of new Set([...extractorInputs, 'pnpm-lock.yaml', 'scripts/prepare-extractor-release.mjs'])) {
    await fs.mkdir(path.dirname(path.join(tmp, file)), { recursive: true });
    await fs.copyFile(path.join(root, file), path.join(tmp, file));
  }
  await fs.symlink(path.join(root, 'node_modules'), path.join(tmp, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  const version = await extractorVersion(tmp);
  const source = path.join(tmp, 'stashbase-extract');
  const published = path.join(tmp, 'published');
  await fs.mkdir(source);
  for (const executable of ['stashbase-extract', 'stashbase-extract.exe']) await fs.writeFile(path.join(source, executable), 'fixture');
  for (const [platform, arch] of extractorTargets) await buildExtractorComponent({ source, output: published,
    manifestPath: path.join(tmp, 'built-manifest.json'), version, platform, arch });
  const release = { tag_name: `v${version}`, draft: false, prerelease: true,
    assets: componentAssetNames(version).map((name) => ({ name, size: 10, state: 'uploaded' })) };
  const statePath = path.join(tmp, 'state.json');
  const callsPath = path.join(tmp, 'calls.jsonl');
  const preload = `import cp from 'node:child_process'; import fs from 'node:fs'; import path from 'node:path';
    import { syncBuiltinESMExports } from 'node:module';
    const state=JSON.parse(fs.readFileSync(${JSON.stringify(statePath)},'utf8'));
    cp.execFileSync=(command,args)=>{
      if(command!=='gh') throw new Error('Unexpected subprocess');
      fs.appendFileSync(${JSON.stringify(callsPath)},JSON.stringify(args)+'\\n');
      if(args[0]==='api' && args[1]==='graphql') return JSON.stringify({data:{repository:{release:state.release?{databaseId:1}:null}}});
      if(args[0]==='api') return JSON.stringify(state.release);
      if(args[1]==='download') {
        const dir=args[args.indexOf('--dir')+1];
        for(let i=0;i<args.length;i++) if(args[i]==='--pattern') {
          const name=args[i+1]; fs.copyFileSync(path.join(${JSON.stringify(published)},name),path.join(dir,name));
          if(state.corrupt && name.endsWith('.tar.gz')) fs.appendFileSync(path.join(dir,name),'bad bytes');
        }
      }
      return '';
    }; syncBuiltinESMExports();`;
  async function run(command, state) {
    await fs.writeFile(statePath, JSON.stringify(state));
    await fs.writeFile(callsPath, '');
    const result = spawnSync(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(preload)}`,
      path.join(tmp, 'scripts/prepare-extractor-release.mjs'), command], {
      encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: path.join(tmp, 'outputs'), COMPONENT_SOURCE_SHA: 'exact-source' },
    });
    return { ...result, calls: (await fs.readFile(callsPath, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse) };
  }
  const reuse = await run('plan', { release });
  assert.equal(reuse.status, 0, reuse.stderr);
  assert.match(reuse.stdout, /build=false/);
  assert.ok(reuse.calls.every(([command]) => command === 'api'));
  const cold = await run('plan', { release: null });
  assert.equal(cold.status, 0, cold.stderr);
  assert.ok(cold.calls.some((args) => args[1] === 'create' && args.includes('--prerelease') && args.includes('exact-source')));
  assert.notEqual((await run('plan', { release: { ...release, draft: true } })).status, 0);

  const embedded = path.join(tmp, 'python/sidecar.nosync/extractor-runtime.json');
  assert.equal((await run('download', { release })).status, 0);
  const original = await fs.readFile(embedded, 'utf8');
  assert.equal(JSON.parse(original).version, version);
  const corrupted = await run('download', { release, corrupt: true });
  assert.notEqual(corrupted.status, 0);
  assert.match(corrupted.stderr, /archive does not match/);
  assert.equal(await fs.readFile(embedded, 'utf8'), original);
  const failedPublication = await run('publish', { release: { ...release, draft: true }, corrupt: true });
  assert.notEqual(failedPublication.status, 0);
  assert.ok(failedPublication.calls.every((args) => args[1] !== 'edit'));
  const publishedResult = await run('publish', { release: { ...release, draft: true } });
  assert.equal(publishedResult.status, 0, publishedResult.stderr);
  assert.ok(publishedResult.calls.some((args) => args[1] === 'edit' && args.includes('--latest=false')));
});
