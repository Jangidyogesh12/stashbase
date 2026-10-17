import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, expect, it, vi } from 'vite-plus/test';

import { focusAgentRequest } from '@/features/agent/application/attention';
import { observeAgentOutcomes } from '@/features/agent/application/outcome-notifications';
import { createAgentWorkspaceRuntime } from '@/features/agent/application/workspace-runtime';
import type { AgentTranscriptBlock } from '@/features/agent/domain/session';
import { useAttentionFocus } from '@/features/agent/hooks/use-attention-focus';
import { AgentTranscript } from '@/features/agent/ui/transcript/transcript';
import { idleAgentSessionPort } from '@/test/fakes/agent';

afterEach(cleanup);
it('focuses the exact pending card, even before the transcript page, only after activation', async () => {
  const runtime = createAgentWorkspaceRuntime({
    createId: () => 'chat',
    folderPath: '/project',
    port: idleAgentSessionPort(),
  });
  const request: AgentTranscriptBlock = {
    kind: 'tool',
    id: 'ask',
    name: 'Bash',
    input: { command: 'pwd' },
    status: 'awaiting',
    permissionId: 'permission',
  };
  const blocks: AgentTranscriptBlock[] = [
    request,
    ...Array.from({ length: 205 }, (_, index): AgentTranscriptBlock => ({
      kind: 'notice',
      id: `later-${index}`,
      text: 'Later activity',
    })),
  ];
  runtime.activeSession().store.setState({
    transcript: blocks,
    connection: { kind: 'live', turn: { promptBlockId: 'prompt' } },
  });
  const scroll = vi
    .spyOn(HTMLElement.prototype, 'scrollIntoView')
    .mockImplementation(() => undefined);
  function View() {
    const log = useRef<HTMLDivElement>(null);
    useAttentionFocus(runtime, 'chat', log);
    return (
      <div ref={log}>
        <AgentTranscript
          activeTurn
          blocks={blocks}
          onOpenExternal={vi.fn()}
          onPermission={() => true}
          onRetry={() => false}
        />
      </div>
    );
  }
  render(<View />);
  const heading = screen.getByRole('heading', { name: 'Run this command?' });
  expect(document.activeElement).not.toBe(heading);
  expect(scroll).not.toHaveBeenCalled();
  act(() => {
    focusAgentRequest(runtime, { sessionId: 'chat', requestId: 'permission' });
  });
  await waitFor(() => expect(document.activeElement).toBe(heading));
  expect(scroll).toHaveBeenCalledWith({ block: 'center' });
  expect(runtime.store.getState().attentionTarget).toBeNull();
  scroll.mockRestore();
  runtime.dispose();
});

it('reveals and retains an older result page when its completion notification is activated', async () => {
  const runtime = createAgentWorkspaceRuntime({
    createId: () => 'chat',
    folderPath: '/project',
    port: idleAgentSessionPort(),
  });
  const session = runtime.activeSession();
  session.store.setState({ connection: { kind: 'live', turn: { promptBlockId: 'prompt' } } });
  const publish = vi.fn<Parameters<typeof observeAgentOutcomes>[1]>();
  const outcomes = observeAgentOutcomes(runtime, publish);
  const blocks: AgentTranscriptBlock[] = [
    { kind: 'assistant', id: 'result', text: 'The completed result' },
    ...Array.from({ length: 205 }, (_, index): AgentTranscriptBlock => ({
      kind: 'notice',
      id: `later-${index}`,
      text: 'Later activity',
    })),
  ];
  session.store.setState({
    transcript: blocks,
    connection: { kind: 'live', turn: null },
    delivery: 'completed',
  });
  const outcome = publish.mock.calls.at(-1)?.[0][0];
  if (!outcome) throw new Error('Expected completion');
  const scroll = vi
    .spyOn(HTMLElement.prototype, 'scrollIntoView')
    .mockImplementation(() => undefined);
  function View() {
    const log = useRef<HTMLDivElement>(null);
    const focusBlockId = useAttentionFocus(runtime, 'chat', log);
    return (
      <div ref={log}>
        <AgentTranscript
          activeTurn={false}
          blocks={blocks}
          focusBlockId={focusBlockId}
          onOpenExternal={vi.fn()}
          onPermission={() => true}
          onRetry={() => false}
        />
      </div>
    );
  }
  render(<View />);
  expect(screen.queryByText('The completed result')).toBeNull();
  act(() => {
    outcomes.activate(outcome.kind, outcome.id);
  });
  await waitFor(() =>
    expect(document.activeElement?.getAttribute('data-notification-block-id')).toBe('result'),
  );
  expect(screen.getByText('The completed result')).toBeTruthy();
  expect(runtime.store.getState().attentionTarget).toBeNull();
  expect(document.activeElement?.isConnected).toBe(true);
  expect(scroll).toHaveBeenCalledWith({ block: 'center' });
  scroll.mockRestore();
  outcomes.dispose();
  runtime.dispose();
});
