import assert from 'node:assert/strict';
import test from 'node:test';
import { HostedAgentBroker } from '../hosted-agent-broker.ts';
import { OpenCodeEventTranslator } from '../opencode-agent.ts';
import { classifyAgentTurnFailure } from '../agent-turn-failure.ts';

test('hosted Agent broker keeps the account credential upstream and streams an OpenAI-compatible response', async (t) => {
  const accessCalls: boolean[] = [];
  const upstream: Array<{ url: string; authorization: string | null; idempotencyKey: string | null; turnId: string | null; profile: string | null; version: string | null; body: string }> = [];
  const broker = new HostedAgentBroker({
    accessToken: async ({ forceRefresh = false } = {}) => {
      accessCalls.push(forceRefresh);
      return forceRefresh ? 'fresh-account-token' : 'stale-account-token';
    },
    fetch: async (input, init) => {
      upstream.push({
        url: String(input),
        authorization: new Headers(init?.headers).get('authorization'),
        idempotencyKey: new Headers(init?.headers).get('idempotency-key'),
        turnId: new Headers(init?.headers).get('x-stashbase-agent-turn-id'),
        profile: new Headers(init?.headers).get('x-stashbase-agent-profile'),
        version: new Headers(init?.headers).get('x-stashbase-agent-profile-version'),
        body: String(init?.body),
      });
      if (upstream.length === 1) return new Response('{}', { status: 401 });
      return new Response('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\ndata: [DONE]\n\n', {
        headers: { 'content-type': 'text/event-stream' },
      });
    },
    upstreamUrl: 'https://gateway.invalid/v1/agent/chat/completions',
    clientVersion: () => 'test-version',
  });
  await broker.start();
  t.after(() => broker.close());
  const runtime = broker.runtime('agent-session-1')!;
  broker.beginTurn('agent-session-1', '00000000-0000-4000-8000-000000000001');

  const response = await fetch(`${runtime.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${runtime.apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: runtime.model, messages: [{ role: 'user', content: 'hello' }], stream: true }),
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /text\/event-stream/);
  assert.match(await response.text(), /\[DONE\]/);
  assert.deepEqual(accessCalls, [false, true]);
  assert.equal(upstream.length, 2);
  assert.equal(upstream[0].authorization, 'Bearer stale-account-token');
  assert.equal(upstream[1].authorization, 'Bearer fresh-account-token');
  assert.ok(upstream[0].idempotencyKey);
  assert.equal(upstream[1].idempotencyKey, upstream[0].idempotencyKey);
  assert.equal(upstream[0].turnId, '00000000-0000-4000-8000-000000000001');
  assert.equal(upstream[1].turnId, upstream[0].turnId);
  assert.equal(upstream[0].profile, 'stashbase-agent-default');
  // An unversioned turn leaves the configuration to the service.
  assert.equal(upstream[0].version, null);
  assert.equal(runtime.model, 'stashbase-agent-default');
  assert.equal(upstream[0].url, 'https://gateway.invalid/v1/agent/chat/completions');
  assert.doesNotMatch(upstream[0].body, /account-token/);
});

test('a turn keeps the model it began with for every call, and the next turn takes a new choice', async (t) => {
  const seen: Array<{ turn: string | null; profile: string | null; version: string | null }> = [];
  const broker = new HostedAgentBroker({
    accessToken: async () => 'fixture-token',
    fetch: async (_url, init) => {
      const headers = new Headers(init?.headers);
      seen.push({
        turn: headers.get('x-stashbase-agent-turn-id'),
        profile: headers.get('x-stashbase-agent-profile'),
        version: headers.get('x-stashbase-agent-profile-version'),
      });
      return new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n', {
        headers: { 'content-type': 'text/event-stream' },
      });
    },
    upstreamUrl: 'https://gateway.invalid', clientVersion: () => 'fixture',
  });
  await broker.start();
  t.after(() => broker.close());
  const runtime = broker.runtime('model-turns')!;
  const call = async () => (await fetch(`${runtime.baseUrl}/chat/completions`, {
    method: 'POST', headers: { authorization: `Bearer ${runtime.apiKey}` },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }], stream: true }),
  })).text();

  const model = { profile: 'writer-pro', version: 3 };
  broker.beginTurn('model-turns', '00000000-0000-4000-8000-000000000011', model);
  // The caller's object changing later cannot move a turn already running.
  model.profile = 'other';
  await call();
  await call();
  broker.endTurn('model-turns');
  broker.beginTurn('model-turns', '00000000-0000-4000-8000-000000000012', { profile: 'writer-fast', version: 1 });
  await call();

  assert.deepEqual(seen, [
    { turn: '00000000-0000-4000-8000-000000000011', profile: 'writer-pro', version: '3' },
    { turn: '00000000-0000-4000-8000-000000000011', profile: 'writer-pro', version: '3' },
    { turn: '00000000-0000-4000-8000-000000000012', profile: 'writer-fast', version: '1' },
  ]);
});

for (const [status, code] of [[422, 'agent_model_configuration_changed'], [503, 'agent_model_unavailable']] as const) {
  test(`a refused model (${code}) ends without a native retry and asks for a model refresh`, async (t) => {
    let calls = 0;
    const broker = new HostedAgentBroker({
      accessToken: async () => 'fixture-token',
      fetch: async () => {
        calls += 1;
        return Response.json({ code, message: 'Service wording may change.' }, { status });
      },
      upstreamUrl: 'https://gateway.invalid', clientVersion: () => 'fixture',
    });
    await broker.start();
    t.after(() => broker.close());
    const runtime = broker.runtime('model-refused')!;
    broker.beginTurn('model-refused', '00000000-0000-4000-8000-000000000013', { profile: 'writer-pro', version: 2 });
    const response = await fetch(`${runtime.baseUrl}/chat/completions`, {
      method: 'POST', headers: { authorization: `Bearer ${runtime.apiKey}` },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    });
    const payload = await response.json() as { error: { code: string; message: string } };
    // 422 is outside the native runtime's retryable statuses.
    assert.equal(response.status, 422);
    assert.equal(payload.error.code, code);
    assert.equal(classifyAgentTurnFailure(payload.error.message), 'model-changed');
    assert.equal(calls, 1);
  });
}

const emptyResponse = 'data: {"choices":[{"delta":{"role":"assistant","content":""},"finish_reason":null}]}\r\n\r\n'
  + 'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":0}}\r\n\r\ndata: [DONE]\r\n\r\n';

async function streamHarness(t: test.TestContext, respond: (attempt: number, signal: AbortSignal) => Response) {
  const calls: Array<{ body: string; key: string | null; turn: string | null }> = [];
  const broker = new HostedAgentBroker({
    accessToken: async () => 'fixture-token',
    fetch: async (_url, init) => {
      const headers = new Headers(init?.headers);
      calls.push({ body: String(init?.body), key: headers.get('idempotency-key'), turn: headers.get('x-stashbase-agent-turn-id') });
      return respond(calls.length, init!.signal!);
    },
    upstreamUrl: 'https://gateway.invalid', clientVersion: () => 'fixture',
  });
  await broker.start();
  t.after(() => broker.close());
  const runtime = broker.runtime('empty-response')!;
  broker.beginTurn('empty-response', '00000000-0000-4000-8000-000000000004');
  return { broker, calls, request: () => fetch(`${runtime.baseUrl}/chat/completions`, {
    method: 'POST', headers: { authorization: `Bearer ${runtime.apiKey}` },
    body: JSON.stringify({ messages: [{ role: 'tool', tool_call_id: 'saved-file', content: 'File already written' }], stream: true }),
  }) };
}

function sse(text: string): Response {
  // Exercise fragmented UTF-8 and SSE delimiters, rather than one convenient chunk.
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({
    start(controller) {
      for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7));
      controller.close();
    },
  }), { headers: { 'content-type': 'text/event-stream' } });
}

test('an empty model response retries only the model call, retaining tool results and turn identity', async (t) => {
  const answer = 'data: {"choices":[{"delta":{"content":"已保存"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
  const harness = await streamHarness(t, attempt => sse(attempt === 1 ? emptyResponse : answer));
  const response = await harness.request();
  assert.equal(response.status, 200);
  assert.equal(await response.text(), answer, 'empty attempt framing must not leak downstream');
  assert.equal(harness.calls.length, 2);
  assert.equal(harness.calls[0].body, harness.calls[1].body, 'never resend the user turn without its tool results');
  assert.equal(harness.calls[0].turn, harness.calls[1].turn);
  assert.notEqual(harness.calls[0].key, harness.calls[1].key, 'a new model attempt must not reuse a settled accounting request');
});

test('repeated empty model responses fail visibly after one retry', async (t) => {
  const harness = await streamHarness(t, () => sse(emptyResponse));
  const response = await harness.request();
  assert.equal(response.status, 422, 'native runtime must not keep retrying an exhausted recovery');
  assert.equal(harness.calls.length, 2);
  const body = await response.json() as { error: { code: string; message: string } };
  assert.equal(body.error.code, 'agent_empty_response');
  assert.match(body.error.message, /empty response twice/);
});

for (const output of [
  { choices: [{ delta: { tool_calls: [{ index: 0, id: 'write', type: 'function', function: { name: 'stashbase_write_file', arguments: '{' } }] } }] },
  { choices: [{ delta: { content: 'Partial reply' } }] },
  { choices: [{ delta: { reasoning_content: 'Thinking' } }] },
  { choices: [{ delta: {}, finish_reason: 'content_filter' }] },
  { error: { message: 'Provider refused this request' } },
]) {
  test(`model output is never replayed: ${JSON.stringify(output)}`, async (t) => {
    const body = `data: ${JSON.stringify(output)}\n\n`;
    let finish!: () => void;
    const harness = await streamHarness(t, () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body));
        finish = () => controller.close();
      },
    }), { headers: { 'content-type': 'text/event-stream' } }));
    const response = await harness.request();
    const reader = response.body!.getReader();
    assert.equal(new TextDecoder().decode((await reader.read()).value), body, 'output must stream before upstream EOF');
    finish();
    assert.equal((await reader.read()).done, true);
    assert.equal(harness.calls.length, 1);
  });
}

test('retiring a turn cancels an empty prefix without starting a retry', async (t) => {
  const entered = deferred<void>();
  const cancelled = deferred<void>();
  const harness = await streamHarness(t, () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(': heartbeat\n\n'));
      entered.resolve();
    },
    cancel() { cancelled.resolve(); },
  }), { headers: { 'content-type': 'text/event-stream' } }));
  const request = assert.rejects(harness.request());
  await entered.promise;
  harness.broker.endTurn('empty-response');
  await Promise.all([request, cancelled.promise]);
  assert.equal(harness.calls.length, 1);
});

test('empty response buffering is bounded and malformed events are not retried', async (t) => {
  const oversized = await streamHarness(t, () => sse(`: ${' '.repeat(65 * 1024)}\n\n`));
  const response = await oversized.request();
  assert.equal(response.status, 422);
  assert.match(await response.text(), /without a reply/);
  assert.equal(oversized.calls.length, 1);
  const malformed = await streamHarness(t, () => sse('data: {broken}\n\n'));
  assert.equal(await (await malformed.request()).text(), 'data: {broken}\n\n');
  assert.equal(malformed.calls.length, 1);
});

for (const scenario of [
  { code: 'agent_allowance_exhausted', message: 'Remaining Agent credits cannot cover this request. Try a shorter conversation or wait for credits to refill.', kind: 'allowance-exhausted' },
  { code: 'agent_turn_budget_exhausted', message: 'This Agent turn has insufficient spending budget for another model call.', kind: 'quota' },
]) {
  test(`hosted Agent broker preserves ${scenario.code} through the OpenCode translator`, async (t) => {
    const broker = new HostedAgentBroker({
      accessToken: async () => 'account-token',
      fetch: async () => Response.json({ code: scenario.code, message: 'Limit reached.' }, { status: 402 }),
      upstreamUrl: 'https://gateway.invalid/v1/agent/chat/completions',
      clientVersion: () => 'test-version',
    });
    await broker.start();
    t.after(() => broker.close());
    const runtime = broker.runtime('agent-session-2')!;
    broker.beginTurn('agent-session-2', '00000000-0000-4000-8000-000000000002');
    const response = await fetch(`${runtime.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${runtime.apiKey}`, 'content-type': 'application/json' },
      body: '{}',
    });
    const payload = await response.json() as { error: { message: string; code: string } };
    assert.equal(response.status, 402);
    assert.equal(payload.error.message, scenario.message);
    assert.equal(payload.error.code, scenario.code);
    const translator = new OpenCodeEventTranslator();
    translator.bindSession('ours');
    translator.beginTurn();
    assert.deepEqual(translator.translate({
      type: 'session.error',
      properties: {
        sessionID: 'ours',
        error: { name: 'APIError', data: { message: payload.error.message, isRetryable: false } },
      },
    }), [
      { t: 'error', message: payload.error.message, failure: { kind: scenario.kind } },
      { t: 'turn-end', isError: true },
    ]);
  });
}

test('hosted Agent broker rejects non-broker credentials before contacting the gateway', async (t) => {
  let called = false;
  const broker = new HostedAgentBroker({
    accessToken: async () => 'account-token',
    fetch: async () => { called = true; return new Response('{}'); },
    upstreamUrl: 'https://gateway.invalid/v1/agent/chat/completions',
    clientVersion: () => 'test-version',
  });
  await broker.start();
  t.after(() => broker.close());
  const response = await fetch(`${broker.runtime()!.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { authorization: 'Bearer wrong', 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal(response.status, 401);
  assert.equal(called, false);
});

test('hosted Agent broker isolates session credentials and rejects calls outside an active turn', async (t) => {
  let called = false;
  const broker = new HostedAgentBroker({
    accessToken: async () => 'account-token',
    fetch: async () => { called = true; return new Response('{}'); },
    upstreamUrl: 'https://gateway.invalid/v1/agent/chat/completions',
    clientVersion: () => 'test-version',
  });
  await broker.start();
  t.after(() => broker.close());
  const first = broker.runtime('agent-session-a')!;
  const second = broker.runtime('agent-session-b')!;
  assert.notEqual(first.apiKey, second.apiKey);

  const response = await fetch(`${first.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${first.apiKey}`, 'content-type': 'application/json' },
    body: '{}',
  });
  const payload = await response.json() as { error: { code: string } };
  assert.equal(response.status, 409);
  assert.equal(payload.error.code, 'agent_turn_required');
  assert.equal(called, false);
  assert.throws(
    () => broker.beginTurn('agent-session-a', 'not-a-uuid'),
    /turn id must be a valid UUID/,
  );
});

for (const during of ['token', 'refresh', 'upstream'] as const) {
  test(`retiring a turn cancels a model call waiting on ${during}`, async (t) => {
    const entered = deferred<void>();
    const token = deferred<string>();
    let upstreamCalls = 0;
    let upstreamSignal: AbortSignal | null | undefined;
    const broker = new HostedAgentBroker({
      accessToken: async ({ forceRefresh } = {}) => {
        if (during === 'token' || (during === 'refresh' && forceRefresh)) {
          entered.resolve();
          return token.promise;
        }
        return 'fixture-token';
      },
      fetch: async (_url, init) => {
        upstreamCalls++;
        upstreamSignal = init?.signal;
        if (during === 'refresh') return new Response('{}', { status: 401 });
        if (during === 'upstream') {
          entered.resolve();
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
          });
        }
        return new Response('{}');
      },
      upstreamUrl: 'https://gateway.invalid',
      clientVersion: () => 'fixture',
    });
    await broker.start();
    t.after(() => broker.close());
    const runtime = broker.runtime('retired')!;
    broker.beginTurn('retired', '00000000-0000-4000-8000-000000000003');
    const request = fetch(`${runtime.baseUrl}/chat/completions`, {
      method: 'POST', headers: { authorization: `Bearer ${runtime.apiKey}` }, body: '{}',
    });
    const rejected = assert.rejects(request);
    await entered.promise;
    broker.endTurn('retired');
    broker.releaseChannel('retired');
    token.resolve('late-token');
    await rejected;
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(upstreamCalls, during === 'token' ? 0 : 1);
    if (upstreamSignal) assert.equal(upstreamSignal.aborted, true);
  });
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}


test('hosted broker adapts inline PDFs without changing image bytes, text, tools, or other file parts', async (t) => {
  let forwarded: Record<string, unknown> | undefined;
  const broker = new HostedAgentBroker({
    accessToken: async () => 'fixture-token',
    fetch: async (_url, init) => {
      forwarded = JSON.parse(String(init?.body));
      return new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
    }, upstreamUrl: 'https://gateway.invalid', clientVersion: () => 'test',
  });
  await broker.start();
  t.after(() => broker.close());
  const runtime = broker.runtime('attachment-test')!;
  broker.beginTurn('attachment-test', '00000000-0000-4000-8000-000000000001');
  const text = { type: 'text', text: 'Read this' };
  const image = { type: 'image_url', image_url: { url: 'data:image/png;base64,aW1hZ2U=' } };
  const file = { type: 'file', file: { filename: 'note.txt', file_data: 'data:text/plain;base64,aGVsbG8=' } };
  const pdf = 'data:application/pdf;base64,JVBERi0xLjQ=';
  const tool = { role: 'tool', content: 'Saved document', tool_call_id: 'one' };
  const response = await fetch(`${runtime.baseUrl}/chat/completions`, {
    method: 'POST', headers: { authorization: `Bearer ${runtime.apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: [text, image, file, { type: 'file', file: { file_data: pdf } }] }, tool], stream: true }),
  });
  assert.equal(response.status, 200);
  await response.text();
  assert.deepEqual(forwarded, { messages: [{ role: 'user', content: [text, image, file, { type: 'image_url', image_url: { url: pdf } }] }, tool], stream: true });
});
