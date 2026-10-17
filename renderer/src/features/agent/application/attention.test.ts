import { expect, it, vi } from 'vite-plus/test';

import type { AgentTranscriptBlock } from '@/features/agent/domain/session';
import { idleAgentSessionPort } from '@/test/fakes/agent';

import { focusAgentRequest, pendingAgentRequests, subscribeAgentAttention } from './attention';
import { createAgentWorkspaceRuntime } from './workspace-runtime';

const ask = (requestId: string, name = 'Bash'): AgentTranscriptBlock => ({
  kind: 'tool',
  id: requestId,
  name,
  input: {},
  status: 'awaiting',
  permissionId: requestId,
});

function fixture() {
  let id = 0;
  const runtime = createAgentWorkspaceRuntime({
    createId: () => `chat-${++id}`,
    folderPath: '/project/Research',
    port: idleAgentSessionPort(),
  });
  const session = runtime.activeSession();
  session.store.setState({ connection: { kind: 'live', turn: { promptBlockId: 'prompt' } } });
  return { runtime, session };
}

it('observes second requests and questions in inactive chats without repeating transcript updates', () => {
  const { runtime, session } = fixture();
  const changed = vi.fn();
  const stop = subscribeAgentAttention(runtime, changed);
  session.store.setState({ transcript: [ask('one')] });
  runtime.newChat();
  session.store.setState({ transcript: [ask('one'), ask('two', 'AskUserQuestion')] });
  expect(changed.mock.calls.at(-1)?.[0]).toHaveLength(2);
  const count = changed.mock.calls.length;
  session.store.setState({ draft: 'unrelated draft' });
  expect(changed).toHaveBeenCalledTimes(count);
  expect(focusAgentRequest(runtime, { sessionId: session.id, requestId: 'two' })).toBe(true);
  expect(runtime.activeSession()).toBe(session);
  expect(runtime.store.getState().attentionTarget?.requestId).toBe('two');
  session.store.setState({ delivery: 'stopping' });
  expect(changed.mock.calls.at(-1)?.[0]).toEqual([]);
  expect(focusAgentRequest(runtime, { sessionId: session.id, requestId: 'two' })).toBe(false);
  stop();
  runtime.dispose();
});

it('ignores historical approvals and retires closed or replaced sessions and subscribers', () => {
  const { runtime, session } = fixture();
  session.store.setState({ transcript: [ask('one')], connection: { kind: 'live', turn: null } });
  expect(pendingAgentRequests(runtime)).toEqual([]);
  const changed = vi.fn();
  const stop = subscribeAgentAttention(runtime, changed);
  session.store.setState({ connection: { kind: 'live', turn: { promptBlockId: 'prompt' } } });
  expect(pendingAgentRequests(runtime)).toHaveLength(1);
  runtime.close(session.id);
  expect(changed.mock.calls.at(-1)?.[0]).toEqual([]);
  expect(focusAgentRequest(runtime, { sessionId: session.id, requestId: 'one' })).toBe(false);
  stop();
  const count = changed.mock.calls.length;
  runtime.activeSession().store.setState({ transcript: [ask('later')] });
  expect(changed).toHaveBeenCalledTimes(count);
  runtime.dispose();
  expect(pendingAgentRequests(runtime)).toEqual([]);
});
