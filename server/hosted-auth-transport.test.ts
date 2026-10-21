import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthNetworkBridge } from '../electron/account/auth-network.ts';
import { createHostedAuthRequest } from './hosted-auth-transport.ts';
import { AUTH_REQUEST_LIMIT, AUTH_RESPONSE_LIMIT, AUTH_BASE_URL } from '../shared/hosted-auth-network.ts';

test('desktop auth uses only the native transport for exchange, refresh, profile and logout', async t => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const bridge = await createAuthNetworkBridge({ fetch: async (url, init) => {
    calls.push({ url: String(url), init });
    return String(url).includes('sign-out') ? new Response(null, { status: 204 })
      : Response.json({ access_token: 'fixture-access' });
  } });
  t.after(() => bridge.close());
  const request = createHostedAuthRequest({ port: String(bridge.port), token: bridge.token, required: true });
  for (const path of ['/electron/token', '/token', '/get-session', '/sign-out']) {
    const response = await request(path, { body: { auth_code: 'fixture-code' }, accessToken: 'fixture-access', signal: AbortSignal.timeout(2000) });
    assert.equal(response.status, path.includes('sign-out') ? 204 : 200);
    if (response.status === 200) assert.deepEqual(await response.json(), { access_token: 'fixture-access' });
  }
  assert.equal(calls.length, 4);
  assert.equal(calls[0].url, `${AUTH_BASE_URL}/electron/token`);
  assert.equal(calls[0].init?.body, JSON.stringify({ auth_code: 'fixture-code' }));
  for (const call of calls) {
    assert.equal(call.init?.redirect, 'error');
    assert.equal(call.init?.credentials, 'omit');
    assert.equal(new Headers(call.init?.headers).get('authorization'), 'Bearer fixture-access');
  }
  assert.equal(calls[2].init?.method, 'GET');
  assert.equal(calls[2].init?.body, undefined);
});

test('private native relay rejects browser callers, invalid capabilities and destinations before sending', async t => {
  let calls = 0;
  const bridge = await createAuthNetworkBridge({ fetch: async () => { calls++; return Response.json({}); } });
  t.after(() => bridge.close());
  const url = `http://127.0.0.1:${bridge.port}/`;
  const headers = { 'x-stashbase-auth-network-token': bridge.token };
  for (const supplied of [undefined, 'wrong', 'a'.repeat(64), 'é'.repeat(64)]) {
    const response = await fetch(url, { method: 'POST', headers: supplied ? { 'x-stashbase-auth-network-token': supplied } : {}, body: '{}' });
    assert.equal(response.status, 403);
    await response.body?.cancel();
  }
  assert.equal((await fetch(url, { method: 'POST', headers: { ...headers, origin: 'https://attacker.example' }, body: '{}' })).status, 403);
  for (const path of ['https://attacker.example', '//attacker.example', '/user/../../admin/users', '/user?redirect=https://attacker.example']) {
    assert.equal((await fetch(url, { method: 'POST', headers, body: JSON.stringify({ path }) })).status, 400);
  }
  assert.equal((await fetch(url, { method: 'POST', headers, body: 'x'.repeat(AUTH_REQUEST_LIMIT + 1) })).status, 413);
  assert.equal(calls, 0);
});

test('native transport retains provider rejection but sends only safe network error codes', async t => {
  let mode = 'http';
  const bridge = await createAuthNetworkBridge({ fetch: async () => {
    if (mode === 'http') return Response.json({ error_code: 'flow_state_expired', msg: 'Expired authorization' }, { status: 400 });
    if (mode === 'large') return new Response('x'.repeat(AUTH_RESPONSE_LIMIT + 1));
    throw new Error('net::ERR_PROXY_CONNECTION_FAILED https://user:private-password@proxy.test/?code=private-code');
  } });
  t.after(() => bridge.close());
  const request = createHostedAuthRequest({ port: String(bridge.port), token: bridge.token, required: true });
  const invoke = () => request('/electron/token', { body: {}, signal: AbortSignal.timeout(2000) });
  const rejected = await invoke();
  assert.equal(rejected.status, 400);
  assert.deepEqual(await rejected.json(), { error_code: 'flow_state_expired', msg: 'Expired authorization' });
  mode = 'network';
  await assert.rejects(invoke, error => {
    assert.match(String(error), /exchange.*system proxy.*ERR_PROXY_CONNECTION_FAILED/);
    assert.doesNotMatch(JSON.stringify(error), /private-password|private-code/);
    return true;
  });
  mode = 'large';
  await assert.rejects(invoke, /AUTH_RESPONSE_TOO_LARGE/);
});

test('caller cancellation and desktop shutdown abort upstream requests without retry', async t => {
  let calls = 0;
  let entered!: () => void;
  let aborted!: () => void;
  const bridge = await createAuthNetworkBridge({ fetch: async (_url, init) => {
    calls++;
    entered();
    return new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => {
      aborted(); reject(init.signal?.reason);
    }, { once: true }));
  } });
  t.after(() => bridge.close());
  const request = createHostedAuthRequest({ port: String(bridge.port), token: bridge.token, required: true });
  for (const closing of [false, true]) {
    const started = new Promise<void>(resolve => { entered = resolve; });
    const stopped = new Promise<void>(resolve => { aborted = resolve; });
    const controller = new AbortController();
    const result = request('/electron/token', { body: {}, signal: controller.signal });
    const rejection = assert.rejects(result, /cancelled|interrupted|ECONNRESET/);
    await started;
    if (closing) bridge.close(); else controller.abort();
    await Promise.all([stopped, rejection]);
  }
  assert.equal(calls, 2);
});

test('desktop missing or failed relay never silently falls back to direct fetch', async () => {
  const oldFetch = globalThis.fetch;
  let direct = 0;
  globalThis.fetch = async () => { direct++; return Response.json({}); };
  try {
    await assert.rejects(createHostedAuthRequest({ required: true })('/get-session', { signal: AbortSignal.timeout(1000) }), /AUTH_BRIDGE_UNAVAILABLE/);
    const bridge = await createAuthNetworkBridge({ fetch: globalThis.fetch });
    bridge.close();
    await assert.rejects(createHostedAuthRequest({ required: true, port: String(bridge.port), token: bridge.token })('/get-session', { signal: AbortSignal.timeout(1000) }));
    assert.equal(direct, 0);
    await createHostedAuthRequest({ required: false })('/get-session', { signal: AbortSignal.timeout(1000) });
    assert.equal(direct, 1);
  } finally { globalThis.fetch = oldFetch; }
});
