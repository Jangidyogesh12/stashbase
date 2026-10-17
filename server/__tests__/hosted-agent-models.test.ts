import './isolated-home.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readHostedAgentModels, publicHostedModels } from '../hosted-agent-models.ts';

const model = { id: 'gemini', version: 1, displayName: 'Gemini 3.8 Flash', isDefault: true, contextTokenLimit: 1000000, outputTokenLimit: 16384, reasoningEnabled: true };
test('hosted model discovery refreshes authentication and exposes only approved display metadata', async () => {
  const refreshes: boolean[] = [];
  let calls = 0;
  const models = await readHostedAgentModels({
    accessToken: async ({ forceRefresh } = {}) => { refreshes.push(forceRefresh === true); return 'private-account-token'; },
    fetch: async (url, init) => {
      assert.equal(String(url), 'https://api.stashbase.ai/v1/agent/models');
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer private-account-token');
      return ++calls === 1 ? new Response('', { status: 401 }) : Response.json({ models: [model, { ...model, id: 'second', displayName: 'Other model', isDefault: false }] });
    },
  });
  assert.deepEqual(refreshes, [false, true]);
  assert.deepEqual(publicHostedModels(models), [{ id: 'gemini', label: 'Gemini 3.8 Flash', isDefault: true }, { id: 'second', label: 'Other model', isDefault: false }]);
});
test('failed or ambiguous hosted catalogs cannot silently invent a default', async () => {
  for (const response of [new Response('', { status: 503 }), Response.json({ models: [] }), Response.json({ models: [model, model] })]) {
    await assert.rejects(readHostedAgentModels({ accessToken: async () => 'token', fetch: async () => response }));
  }
});
