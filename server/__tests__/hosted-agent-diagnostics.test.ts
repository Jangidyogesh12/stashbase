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
