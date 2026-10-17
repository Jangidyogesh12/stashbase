import { expect, it, vi } from 'vite-plus/test';

import { idleAgentSessionPort } from '@/test/fakes/agent';

import { focusDesktopSession, subscribeDesktopSessions } from './desktop-sessions';
import { createAgentWorkspaceRuntime } from './workspace-runtime';

it('projects inactive session work, waiting, stopping and completion without transcript churn or stale activation', () => {
  let sequence = 0;
  const runtime = createAgentWorkspaceRuntime({
    createId: () => `chat-${++sequence}`,
    folderPath: '/project',
    port: idleAgentSessionPort(),
  });
  const session = runtime.activeSession();
  const publish = vi.fn<Parameters<typeof subscribeDesktopSessions>[1]>();
  const stop = subscribeDesktopSessions(runtime, publish);
  expect(publish.mock.calls.at(-1)?.[0]).toEqual([]);
  session.store.setState({ connection: { kind: 'live', turn: { promptBlockId: 'prompt' } } });
  expect(publish.mock.calls.at(-1)?.[0][0]?.state).toBe('working');
  const calls = publish.mock.calls.length;
  session.store.setState({ draft: 'typing' });
  expect(publish).toHaveBeenCalledTimes(calls);
  runtime.newChat();
  session.store.setState({
    transcript: [
      {
        kind: 'tool',
        id: 'tool',
        name: 'Bash',
        input: {},
        status: 'awaiting',
        permissionId: 'approval',
      },
    ],
  });
  expect(publish.mock.calls.at(-1)?.[0][0]?.state).toBe('waiting');
  expect(focusDesktopSession(runtime, session.id)).toBe(true);
  expect(runtime.store.getState().attentionTarget?.requestId).toBe('approval');
  session.store.setState({ delivery: 'stopping' });
  expect(publish.mock.calls.at(-1)?.[0][0]).toMatchObject({
    state: 'working',
    detail: 'Stopping…',
  });
  session.store.setState({ delivery: 'completed', connection: { kind: 'live', turn: null } });
  expect(publish.mock.calls.at(-1)?.[0]).toEqual([]);
  expect(focusDesktopSession(runtime, session.id)).toBe(false);
  runtime.close(session.id);
  expect(focusDesktopSession(runtime, session.id)).toBe(false);
  expect(publish.mock.calls.at(-1)?.[0]).toEqual([]);
  stop();
  runtime.dispose();
});
