import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertMacUpdateArtifacts } from './update-artifact-contract.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const releaseDir = path.join(root, 'release.nosync');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const skipBuild = args.has('--skip-build');
const skipSmoke = args.has('--skip-smoke');
const requireDraft = args.has('--require-draft');
const tag = `v${pkg.version}`;
const repo = process.env.GITHUB_REPOSITORY || repositorySlug(pkg.repository?.url);

// Release packaging downloads the independent PDF/OCR component and embeds its
// exact manifest; the base installer never carries the extractor payload.
if (process.platform === 'darwin') process.env.STASHBASE_RELEASE_BUILD = '1';

if (!repo) {
  throw new Error('Unable to determine GitHub repository. Set GITHUB_REPOSITORY=owner/repo.');
}

function repositorySlug(value) {
  if (!value) return null;
  return String(value)
    .replace(/^git\+/, '')
    .replace(/^git@github\.com:/, 'https://github.com/')
    .replace(/^https?:\/\/github\.com\//, '')
    .replace(/\.git$/, '')
    .replace(/\/$/, '');
}

function run(command, commandArgs) {
  execFileSync(command, commandArgs, {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
  });
}

function listArtifacts() {
  if (!fs.existsSync(releaseDir)) return [];

  return fs
    .readdirSync(releaseDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
    .filter((entry) => entry.name.includes(pkg.version) || /^latest.*\.ya?ml$/.test(entry.name))
    .map((entry) => path.join(releaseDir, entry.name))
    .filter((file) => fs.statSync(file).size > 0)
    .sort();
}

if (!skipBuild) {
  run(process.execPath, [path.join(root, 'scripts', 'package-desktop.mjs')]);
}
if (!skipSmoke && process.platform === 'darwin') {
  run(process.execPath, [
    path.join(root, 'scripts', 'smoke-packaged-server.mjs'),
  ]);
}
if (process.platform === 'darwin') {
  run(process.execPath, [
    path.join(root, 'scripts', 'release-verify-mac.mjs'),
    '--skip-build',
    '--skip-smoke',
  ]);
}

const artifacts = listArtifacts();
if (artifacts.length === 0) {
  throw new Error(`No release artifacts found in ${releaseDir}.`);
}
if (process.platform === 'darwin') assertMacUpdateArtifacts(artifacts);

console.log(`[release] ${repo} ${tag}`);
for (const file of artifacts) {
  console.log(`[release] artifact ${path.relative(root, file)}`);
}

if (dryRun) {
  console.log(`[release] dry run: https://github.com/${repo}/releases/tag/${tag}`);
  process.exit(0);
}

if (!requireDraft) {
  throw new Error('Real uploads must use --require-draft from the coordinated Release workflow.');
}

run(process.execPath, [path.join(root, 'scripts', 'upload-release-assets.mjs'), ...artifacts]);
