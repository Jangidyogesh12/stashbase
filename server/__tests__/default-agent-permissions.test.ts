import assert from 'node:assert/strict';
import test from 'node:test';
import { reviewDefaultAgentPermission } from '../default-agent-permissions.ts';

const request = { name: 'Bash', input: { command: 'pwd' }, project: '/project', userRequest: 'Show the project directory.' };

test('Auto returns to manual approval at its deadline even if credential acquisition is still pending', async (t) => {
  const timeout = new AbortController();
  t.mock.method(AbortSignal, 'timeout', () => timeout.signal);
  let finish!: (value: string) => void;
  let callSignal!: AbortSignal;
  const review = reviewDefaultAgentPermission(request, async (_messages, signal) => {
    callSignal = signal;
    return new Promise<string>((resolve) => { finish = resolve; });
  }, new AbortController().signal);
  timeout.abort();
  assert.equal(await review, false);
  assert.equal(callSignal.aborted, true);
  finish('ALLOW');
});

test('Auto retains explicit authority for destructive tools, missing arguments, and excessive review input', async () => {
  let calls = 0;
  for (const action of [
    { ...request, name: 'stashbase_delete_file' },
    { ...request, name: 'stashbase_move_file' },
    { ...request, name: 'unknown_mcp_tool' },
    { ...request, input: {} },
    { ...request, userRequest: '' },
    { ...request, input: { command: 'x'.repeat(24_000) } },
  ]) {
    assert.equal(await reviewDefaultAgentPermission(action, async () => { calls++; return 'ALLOW'; }, new AbortController().signal), false);
  }
  assert.equal(calls, 0);
});
