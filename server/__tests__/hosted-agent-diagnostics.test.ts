import './isolated-home.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { HostedAgentRequestDiagnostic } from '../hosted-agent-diagnostics.ts';

test('request timing distinguishes response headers, first bytes, and visible text without retaining content', async (t) => {
  let now = 0;
  t.mock.method(performance, 'now', () => now);
  const diagnostic = new HostedAgentRequestDiagnostic('request-1', 1);
  let source!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(controller) { source = controller; } });
  now = 10;
  const reader = diagnostic.response(new Response(body, { headers: { 'content-type': 'text/event-stream' } })).body!.getReader();
  const send = async (value: unknown, time: number) => {
    now = time;
    source.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`));
    await reader.read();
  };
  await send({ choices: [{ delta: { reasoning_content: 'PRIVATE REASONING' } }] }, 20);
  await send({ choices: [{ delta: { content: 'PRIVATE TEXT' } }] }, 30);
  await send({ usage: { prompt_tokens: 100, completion_tokens: 5, prompt_tokens_details: {
    cached_tokens: 80, cache_write_tokens: 20,
  } } }, 40);
  now = 50;
  source.close();
  await reader.read();
  const snapshot = diagnostic.snapshot();
  const values = JSON.parse(snapshot.message.slice(snapshot.message.indexOf('{')));
  assert.deepEqual([
    values.headers_ms, values.first_byte_ms, values.first_text_ms, values.elapsed_ms,
    values.input_tokens, values.output_tokens, values.cached_tokens, values.cache_write_tokens,
  ], [10, 20, 30, 50, 100, 5, 80, 20]);
  assert.doesNotMatch(JSON.stringify(snapshot), /PRIVATE/);
});


test('model stream failure reports at its source before a runtime can drop the explanation', async (t) => {
  const { telemetry } = await import('../telemetry.ts');
  const records: any[] = [];
  const stages: any[] = [];
  t.mock.method(telemetry, 'scoped', () => (event: unknown) => { records.push(event); });
  t.mock.method(telemetry, 'observeTurn', (id: string | undefined, event: Parameters<typeof telemetry.observeTurn>[1]) => { stages.push({ id, event }); });
  const turnId = crypto.randomUUID();
  const callId = crypto.randomUUID();
  const diagnostic = new HostedAgentRequestDiagnostic(callId, 2, { profile: 'fixture', turnId });
  const response = diagnostic.response(new Response('data: {"error":{"message":"upstream failed","code":"OVERLOADED"}}\n\n', {
    headers: { 'content-type': 'text/event-stream', 'x-request-id': 'upstream-42' },
  }));
  await response.text();
  assert.equal(records.length, 1);
  assert.equal(records[0].turn_id, turnId);
  assert.equal(records[0].context.call_id, callId);
  assert.equal(records[0].diagnostic.request_id, 'upstream-42');
  assert.equal(records[0].diagnostic.causes[0].code, 'OVERLOADED');
  assert.deepEqual(stages.map(({ event }) => event.stage), ['model_request_started', 'response_started']);
});
