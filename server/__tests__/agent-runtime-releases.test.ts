import './isolated-home.ts';

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AGENT_RELEASE_FEEDS,
  createAgentReleaseChecker,
  isNewerRelease,
} from '../agent-runtime-releases.ts';

function feeds(url = () => 'https://feed.test/latest') {
  const feed = { url, maxBytes: 64, version: (body: string) => body.trim() || null };
  return { claude: feed, codex: feed, antigravity: feed };
}

test('only a strictly later release is offered as an update', () => {
  assert.equal(isNewerRelease('2.1.302', '2.1.280'), true);
  assert.equal(isNewerRelease('1.4.0', '1.4.0'), false);
  assert.equal(isNewerRelease('0.160.0', '0.163.0'), false);
  assert.equal(isNewerRelease('1.10.0', '1.9.9'), true);
  assert.equal(isNewerRelease('1.5.0', '1.5.0-beta.2'), true);
  assert.equal(isNewerRelease('1.5.0-beta.2', '1.5.0'), false);
  assert.equal(isNewerRelease('1.5.0-beta.10', '1.5.0-beta.9'), true);
  assert.equal(isNewerRelease('not-a-version', '1.0.0'), false);
});

test('each provider feed reads the version its installer would install', () => {
  assert.equal(AGENT_RELEASE_FEEDS.claude.version('2.1.302\n'), '2.1.302');
  assert.equal(AGENT_RELEASE_FEEDS.codex.version('{"tag_name":"rust-v0.163.0","assets":[]}'), '0.163.0');
  assert.equal(
    AGENT_RELEASE_FEEDS.antigravity.version('{"version":"1.4.0","url":"https://x","sha512":"y"}'),
    '1.4.0',
  );
  assert.equal(AGENT_RELEASE_FEEDS.claude.version('<html>blocked</html>'), null);
  assert.equal(AGENT_RELEASE_FEEDS.antigravity.version('{"url":"https://x"}'), null);
});

test('discovery answers from the last reading and refreshes it in the background', async () => {
  let time = 0;
  let latest = '1.5.0';
  const requests: string[] = [];
  const checker = createAgentReleaseChecker({
    feeds: feeds(),
    enabled: () => true,
    now: () => time,
    fetchText: async (url) => {
      requests.push(url);
      return latest;
    },
  });

  // The first answer never waits for the feed.
  assert.equal(checker.availableUpdate('antigravity', '1.4.0'), null);
  await checker.settled();
  assert.equal(checker.availableUpdate('antigravity', '1.4.0'), '1.5.0');
  // Up to date is nothing to offer.
  assert.equal(checker.availableUpdate('antigravity', '1.5.0'), null);
  assert.equal(requests.length, 1);

  time += 60 * 60_000;
  latest = '1.6.0';
  assert.equal(checker.availableUpdate('antigravity', '1.4.0'), '1.5.0');
  await checker.settled();
  assert.equal(checker.availableUpdate('antigravity', '1.4.0'), '1.6.0');
  assert.equal(requests.length, 2);
});

test('a failed read keeps the last known release and retries sooner', async () => {
  let time = 0;
  let fail = false;
  let requests = 0;
  const checker = createAgentReleaseChecker({
    feeds: feeds(),
    enabled: () => true,
    now: () => time,
    fetchText: async () => {
      requests += 1;
      if (fail) throw new Error('offline');
      return '2.0.0';
    },
  });
  checker.availableUpdate('codex', '1.0.0');
  await checker.settled();

  fail = true;
  time += 60 * 60_000;
  checker.availableUpdate('codex', '1.0.0');
  await checker.settled();
  assert.equal(checker.availableUpdate('codex', '1.0.0'), '2.0.0');

  time += 14 * 60_000;
  checker.availableUpdate('codex', '1.0.0');
  assert.equal(requests, 2);
  time += 60_000;
  checker.availableUpdate('codex', '1.0.0');
  await checker.settled();
  assert.equal(requests, 3);
});

test('turning automatic update checks off stops reading feeds and offering updates', async () => {
  let enabled = true;
  let requests = 0;
  const checker = createAgentReleaseChecker({
    feeds: feeds(),
    enabled: () => enabled,
    fetchText: async () => {
      requests += 1;
      return '9.0.0';
    },
  });
  checker.availableUpdate('claude', '1.0.0');
  await checker.settled();
  enabled = false;
  assert.equal(checker.availableUpdate('claude', '1.0.0'), null);
  assert.equal(requests, 1);
});
