import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { extractorVersion, extractorTargets, componentAssetNames, assertComponentRelease, verifyExtractorArchive } from './packaging/extractor-release.mjs';

const root = path.resolve(import.meta.dirname, '..');
const version = await extractorVersion(root);
const tag = `v${version}`;
const repo = process.env.GITHUB_REPOSITORY || 'liliu-z/stashbase';
const [owner, name] = repo.split('/');
const gh = (args) => execFileSync('gh', args, { encoding: 'utf8', timeout: 15 * 60_000, maxBuffer: 4 * 1024 * 1024 });
const output = async (key, value) => {
  console.log(`${key}=${value}`);
  if (process.env.GITHUB_OUTPUT) await fs.appendFile(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
};
async function release() {
  // GraphQL includes drafts; a REST tag lookup treats a draft as absent.
  const query = 'query($owner:String!,$name:String!,$tag:String!){repository(owner:$owner,name:$name){release(tagName:$tag){databaseId}}}';
  const lookup = JSON.parse(gh(['api', 'graphql', '-f', `query=${query}`, '-f', `owner=${owner}`, '-f', `name=${name}`, '-f', `tag=${tag}`]));
  if (lookup.errors) throw new Error('Extractor release lookup failed');
  const id = lookup.data.repository.release?.databaseId;
  return id ? JSON.parse(gh(['api', `repos/${repo}/releases/${id}`])) : null;
}
async function download(directory, names) {
  await fs.mkdir(directory, { recursive: true });
  gh(['release', 'download', tag, '--repo', repo, '--dir', directory, ...names.flatMap((name) => ['--pattern', name])]);
}

switch (process.argv[2]) {
  case 'plan': {
    await output('version', version);
    const existing = await release();
    if (existing && !existing.draft) {
      assertComponentRelease(existing, version);
      await output('build', 'false');
    } else {
      if (existing?.assets.length) throw new Error(`Delete incomplete draft ${tag} before retrying; component bytes are immutable`);
      if (!existing) gh(['release', 'create', tag, '--repo', repo, '--target', process.env.COMPONENT_SOURCE_SHA,
        '--draft', '--prerelease', '--latest=false', '--title', `PDF/OCR ${version}`,
        '--notes', 'Immutable PDF/OCR runtime. Installed only through an application-pinned manifest.']);
      await output('build', 'true');
    }
    break;
  }
  case 'publish': {
    assertComponentRelease(await release(), version, { draft: true });
    await fs.mkdir(path.join(root, 'release.nosync'), { recursive: true });
    const directory = await fs.mkdtemp(path.join(root, 'release.nosync/component-verification-'));
    try {
      await download(directory, componentAssetNames(version));
      for (const [platform, arch] of extractorTargets) await verifyExtractorArchive(directory, version, platform, arch);
      gh(['release', 'edit', tag, '--repo', repo, '--draft=false', '--prerelease', '--latest=false']);
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
    break;
  }
  case 'download': {
    assertComponentRelease(await release(), version);
    const directory = path.join(root, 'release.nosync');
    await fs.mkdir(directory, { recursive: true });
    const staging = await fs.mkdtemp(path.join(directory, 'component-download-'));
    try {
      const asset = `stashbase-extract-${version}-${process.platform}-${process.arch}.tar.gz`;
      await download(staging, [asset, asset.replace(/\.tar\.gz$/, '.json')]);
      const verified = await verifyExtractorArchive(staging, version, process.platform, process.arch);
      await fs.copyFile(verified.archive, path.join(directory, asset));
      const manifestPath = path.join(root, 'python/sidecar.nosync/extractor-runtime.json');
      await fs.mkdir(path.dirname(manifestPath), { recursive: true });
      await fs.copyFile(verified.manifestPath, manifestPath);
    } finally { await fs.rm(staging, { recursive: true, force: true }); }
    break;
  }
  default: throw new Error('Expected plan, publish, or download');
}
