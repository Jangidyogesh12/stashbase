import './isolated-home.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchHostedAgentProfiles, hostedAgentCatalogModels, parseHostedAgentProfiles } from '../hosted-agent-models.ts';

const profile = {
  id: 'writer-fast', version: 3, displayName: 'Writer Fast', contextTokenLimit: 1_048_576,
  outputTokenLimit: 8_192, reasoningEnabled: true, reasoningEffort: 'low', isDefault: true,
};

test('the model list keeps what this client can run and drops entries it cannot read', () => {
  const profiles = parseHostedAgentProfiles({ models: [
    profile,
    { ...profile, id: 'writer-fast', version: 4 },
    { id: 'no-version', displayName: 'Broken', contextTokenLimit: 1, outputTokenLimit: 1, isDefault: false },
    { ...profile, id: 'writer-pro', version: 1, isDefault: false, futureField: 'ignored' },
  ] });
  assert.deepEqual(profiles.map((entry) => [entry.id, entry.version]), [['writer-fast', 3], ['writer-pro', 1]]);
  // Upstream identity and reasoning settings never reach the picker.
  assert.deepEqual(hostedAgentCatalogModels(profiles)[0], {
    id: 'writer-fast', label: 'Writer Fast', description: '1M context · 8K output', isDefault: true,
  });
  assert.throws(() => parseHostedAgentProfiles({ data: [] }), /unexpected shape/);
});

test('the model list is read with the account token, refreshed once on 401', async () => {
  const calls: Array<{ url: string; authorization: string | null }> = [];
  const profiles = await fetchHostedAgentProfiles({
    accessToken: async ({ forceRefresh = false } = {}) => forceRefresh ? 'fresh' : 'stale',
    fetch: async (url, init) => {
      calls.push({ url, authorization: new Headers(init?.headers).get('authorization') });
      return calls.length === 1 ? new Response('{}', { status: 401 }) : Response.json({ models: [profile] });
    },
  });
  assert.deepEqual(calls.map((call) => call.authorization), ['Bearer stale', 'Bearer fresh']);
  assert.match(calls[0]!.url, /\/v1\/agent\/models$/);
  assert.equal(profiles[0]?.id, 'writer-fast');

  await assert.rejects(fetchHostedAgentProfiles({
    accessToken: async () => 'token',
    fetch: async () => Response.json({ code: 'agent_disabled', message: 'StashBase Agent is temporarily disabled.' }, { status: 503 }),
  }), /temporarily disabled/);
});

test('limits read in the unit the service set them in', () => {
  const sized = (contextTokenLimit: number, outputTokenLimit: number) =>
    hostedAgentCatalogModels([{ ...profile, contextTokenLimit, outputTokenLimit }])[0]!.description;
  assert.equal(sized(1_048_576, 65_536), '1M context · 64K output');
  assert.equal(sized(1_000_000, 128_000), '1M context · 128K output');
  assert.equal(sized(200_000, 32_000), '200K context · 32K output');
});
