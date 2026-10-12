import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { releaseRepository } from './github-release-api.mjs';
import { macCaskContent } from './packaging/macos-cask.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const releaseDir = path.join(root, 'release.nosync');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const repo = releaseRepository(pkg);
const tap = process.env.HOMEBREW_TAP || 'liliu-z/stashbase';
const tapGitUrl = process.env.HOMEBREW_TAP_GIT_URL || 'git@github.com:liliu-z/homebrew-stashbase.git';
const cask = process.env.HOMEBREW_CASK || 'stashbase';

function releaseFiles() {
  if (!fs.existsSync(releaseDir)) return [];
  return fs
    .readdirSync(releaseDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(releaseDir, entry.name));
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function checkBrew() {
  try {
    execFileSync('brew', ['--version'], { stdio: 'ignore' });
  } catch {
    throw new Error('Homebrew is required for publishing the cask. Install brew and try again.');
  }
}

function run(command, commandArgs, options = {}) {
  execFileSync(command, commandArgs, {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    ...options,
  });
}

function ensureTap() {
  const tapped = execFileSync('brew', ['tap'], { encoding: 'utf8' })
    .split('\n')
    .map((line) => line.trim())
    .includes(tap);

  if (tapped) return;
  run('brew', ['tap', tap, tapGitUrl]);
}

function tapRepoPath() {
  return execFileSync('brew', ['--repo', tap], { encoding: 'utf8' }).trim();
}

function git(tapRepo, args, options = {}) {
  return execFileSync('git', ['-C', tapRepo, ...args], {
    encoding: 'utf8',
    stdio: options.stdio || 'pipe',
  });
}

function publishCask(checksums) {
  const tapRepo = tapRepoPath();
  const casksDir = path.join(tapRepo, 'Casks');
  const caskPath = path.join(casksDir, `${cask}.rb`);
  const branch = git(tapRepo, ['branch', '--show-current']).trim() || 'HEAD';
  const status = git(tapRepo, ['status', '--short']).trim();

  if (status) {
    throw new Error(`Homebrew tap has uncommitted changes in ${tapRepo}:\n${status}`);
  }

  git(tapRepo, ['pull', '--ff-only'], { stdio: 'inherit' });

  const content = macCaskContent({ cask, version: pkg.version, productName: pkg.build?.productName || 'StashBase',
    description: pkg.description, repo, appId: pkg.build?.appId || 'com.stashbase.app', checksums });
  if (dryRun) {
    console.log(`[homebrew] dry run: would write ${caskPath}`);
    console.log(content);
    return;
  }

  fs.mkdirSync(casksDir, { recursive: true });
  fs.writeFileSync(caskPath, content);

  const changed = git(tapRepo, ['status', '--short']).trim();
  if (!changed) {
    console.log('[homebrew] cask is already up to date');
    return;
  }

  git(tapRepo, ['add', caskPath], { stdio: 'inherit' });
  git(tapRepo, ['commit', '-m', `Update ${cask} to ${pkg.version}`], { stdio: 'inherit' });
  git(tapRepo, ['push', 'origin', branch], { stdio: 'inherit' });
}

const productName = pkg.build?.productName || 'StashBase';
const files = releaseFiles();
const checksums = Object.fromEntries(['arm64', 'x64'].map((arch) => {
  const name = `${productName}-${pkg.version}-mac-${arch}.dmg`;
  const dmg = files.find((file) => path.basename(file) === name);
  if (!dmg) throw new Error(`Homebrew requires ${name}`);
  return [arch, sha256(dmg)];
}));

checkBrew();
ensureTap();
console.log(`[homebrew] ${tap}/${cask} -> ${pkg.version} (arm64 + x64)`);
publishCask(checksums);
