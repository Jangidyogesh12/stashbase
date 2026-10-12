import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { extractorAssetName, extractorManifestSchema, extractorDownloadUrl } from '../../shared/extractor-runtime.ts';

export const extractorTargets = [
  ['darwin', 'arm64'], ['darwin', 'x64'], ['linux', 'x64'], ['win32', 'x64'],
];

// Published binaries retain their original build environment. Image rotation
// does not require republishing; changing this recipe deliberately does.
export const extractorInputs = [
  'python/extract_main.py', 'python/pdf_extract.py', 'python/ocr_extract.py',
  'python/requirements.txt', 'python/requirements-extract.txt',
  'python/build-requirements.txt', 'python/constraints.txt',
  'scripts/build-python-sidecar.mjs', 'scripts/setup-python.mjs', 'scripts/lock-python.mjs',
  'scripts/build-extractor-component.mjs', 'scripts/packaging/extractor-component.mjs',
  'scripts/packaging/sign-extractor.mjs', 'scripts/macos-release-contract.mjs',
  'scripts/packaging/extractor-release.mjs', 'shared/extractor-runtime.ts',
  '.github/actions/prepare-native-components/action.yml',
  '.github/workflows/extractor-components.yml',
];

export async function extractorVersion(root, read = (file) => fs.readFile(path.join(root, file), 'utf8')) {
  const hash = crypto.createHash('sha256');
  for (const file of extractorInputs) hash.update(JSON.stringify([file, (await read(file)).replaceAll('\r\n', '\n')]));
  // Only the archive/schema dependencies affect these bytes. Renderer or app
  // version updates must not invalidate the native component's identity.
  const lock = parse(await read('pnpm-lock.yaml'));
  const visited = new Set();
  function dependency(name, version) {
    const key = `${name}@${version}`;
    if (visited.has(key)) return;
    visited.add(key);
    const snapshot = lock.snapshots[key];
    const resolution = lock.packages[key]?.resolution;
    if (!snapshot || !resolution) throw new Error(`Missing locked extractor dependency: ${key}`);
    hash.update(JSON.stringify([key, resolution]));
    for (const [child, value] of Object.entries(snapshot.dependencies ?? {}).sort()) dependency(child, value);
  }
  for (const name of ['tar', 'zod']) dependency(name, lock.importers['.'].dependencies[name].version);
  return `0.0.0-extractor.${hash.digest('hex')}`;
}

export function componentAssetNames(version) {
  return extractorTargets.flatMap(([platform, arch]) => {
    const archive = extractorAssetName(version, platform, arch);
    return [archive, archive.replace(/\.tar\.gz$/, '.json')];
  });
}

export function assertComponentRelease(release, version, { draft = false } = {}) {
  if (!release || release.tag_name !== `v${version}` || release.draft !== draft || !release.prerelease) {
    throw new Error(`Expected ${draft ? 'draft' : 'published'} extractor prerelease v${version}`);
  }
  for (const name of componentAssetNames(version)) {
    const matches = release.assets.filter((asset) => asset.name === name);
    if (matches.length !== 1 || matches[0].state !== 'uploaded' || matches[0].size <= 0) {
      throw new Error(`Incomplete extractor release: ${name}`);
    }
  }
}

export async function verifyExtractorArchive(directory, version, platform, arch, embeddedManifestPath) {
  const asset = extractorAssetName(version, platform, arch);
  const manifestPath = embeddedManifestPath ?? path.join(directory, asset.replace(/\.tar\.gz$/, '.json'));
  const manifest = extractorManifestSchema.parse(JSON.parse(await fs.readFile(manifestPath, 'utf8')));
  extractorDownloadUrl(manifest);
  if (manifest.version !== version || manifest.platform !== platform || manifest.arch !== arch || manifest.asset !== asset) {
    throw new Error('Extractor component manifest does not match the selected inputs and target');
  }
  const archive = path.join(directory, asset);
  const hash = crypto.createHash('sha256');
  for await (const chunk of createReadStream(archive)) hash.update(chunk);
  if ((await fs.stat(archive)).size !== manifest.sizeBytes || hash.digest('hex') !== manifest.sha256) {
    throw new Error('Extractor component archive does not match its embedded manifest');
  }
  return { manifest, manifestPath, archive };
}
