import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export function automaticReleaseTag({ run, repository, version, previousVersion, subject, sha }) {
  if (run?.event !== 'push' || run.conclusion !== 'success' || run.head_branch !== 'main'
    || run.head_repository?.full_name !== repository || run.head_sha !== sha) return null;
  // A deliberate maintainer release commit is the trigger, not every main push
  // or a PR that happens to edit package.json.
  if (subject !== `chore: bump to ${version}` || previousVersion === version) return null;
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Automatic releases require a stable semantic version');
  return `v${version}`;
}

export function isNewerRelease(tag, latestTag) {
  if (!latestTag) return true;
  if (!/^v\d+\.\d+\.\d+$/.test(latestTag)) throw new Error('Unexpected latest desktop release version');
  const candidate = tag.slice(1).split('.').map(Number);
  const latest = latestTag.slice(1).split('.').map(Number);
  for (let i = 0; i < candidate.length; i++) {
    if (candidate[i] !== latest[i]) return candidate[i] > latest[i];
  }
  return false;
}

function main() {
  const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const repo = process.env.GITHUB_REPOSITORY;
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
  let tag = process.env.INPUT_TAG;
  if (process.env.GITHUB_EVENT_NAME === 'workflow_run') {
    const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
    tag = automaticReleaseTag({ run: event.workflow_run, repository: repo, version,
      previousVersion: JSON.parse(git('show', 'HEAD^:package.json')).version,
      subject: git('log', '-1', '--format=%s'), sha: git('rev-parse', 'HEAD') });
    if (tag) {
      const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8', timeout: 60_000 });
      const [owner, name] = repo.split('/');
      const query = 'query($owner:String!,$name:String!){repository(owner:$owner,name:$name){latestRelease{tagName}}}';
      const lookup = JSON.parse(gh('api', 'graphql', '-f', `query=${query}`, '-f', `owner=${owner}`, '-f', `name=${name}`));
      if (lookup.errors) throw new Error('Latest release lookup failed');
      const latest = lookup.data.repository.latestRelease?.tagName;
      // CI reruns and delayed completions must not republish a version or move
      // the stable update channel backwards. Manual retry still uses the gate.
      if (!isNewerRelease(tag, latest)) {
        fs.appendFileSync(process.env.GITHUB_OUTPUT, 'tag=\n');
        return;
      }
      // An existing tag must still identify this exact commit. Never move it.
      const refs = JSON.parse(gh('api', `repos/${repo}/git/matching-refs/tags/${tag}`));
      const existing = refs.find((ref) => ref.ref === `refs/tags/${tag}`);
      if (existing) {
        if (existing.object.type !== 'commit' || existing.object.sha !== event.workflow_run.head_sha) {
          throw new Error(`Existing release tag ${tag} does not match the successful CI commit`);
        }
      } else {
        gh('api', '--method', 'POST', `repos/${repo}/git/refs`, '-f', `ref=refs/tags/${tag}`, '-f', `sha=${event.workflow_run.head_sha}`);
      }
    }
  } else {
    if (!/^v?\d+\.\d+\.\d+$/.test(tag ?? '')) throw new Error('A stable release tag is required');
    tag = tag.startsWith('v') ? tag : `v${tag}`;
  }
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `tag=${tag ?? ''}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
