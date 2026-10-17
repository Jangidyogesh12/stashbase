import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vite-plus/test';

import { agentGateLifted, agentSessionPort } from '@/test/fakes/agent';

import { registerWorkspaceCleanup, renderWorkspace } from './workspace.harness';

registerWorkspaceCleanup();

describe('Agent workspace recovery', () => {
  it('reconnects without resending while retaining history, draft, and paused queue', async () => {
    const { port, listeners, sent } = agentSessionPort();
    const { runtime } = renderWorkspace(port);
    await agentGateLifted();
    const session = runtime.activeSession();
    await act(async () => {
      session.start();
      listeners[0]?.onEvent({ kind: 'identified', id: 'model-refresh-chat' });
      listeners[0]?.onEvent({ kind: 'ready' });
      await session.sendPrompt('Keep this refused request');
      session.setDraft('An unsent follow-up');
      session.setQueue([{ id: 'pending', text: 'Queued work' }]);
      listeners[0]?.onEvent({
        kind: 'failed',
        message: 'Reconnect to refresh the available models.',
      });
      listeners[0]?.onEvent({ kind: 'turn-ended', isError: true });
      listeners[0]?.onEvent({
        kind: 'exited',
        message: 'Reconnect to refresh the available models.',
      });
      listeners[0]?.onClose();
    });
    expect(session.store.getState().delivery).toBe('failed');
    expect(
      session.store
        .getState()
        .transcript.some(
          (block) => block.kind === 'user' && block.text === 'Keep this refused request',
        ),
    ).toBe(true);
    expect(screen.getByRole('button', { name: 'Reconnect' })).not.toBeNull();
    expect(port.connect).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Reconnect' }));
    expect(port.connect).toHaveBeenLastCalledWith(
      expect.objectContaining({ resume: 'model-refresh-chat' }),
      expect.anything(),
    );
    await act(async () => {
      listeners[1]?.onEvent({
        kind: 'models',
        models: [{ id: 'refreshed', label: 'Updated model' }],
        activeModel: 'refreshed',
        fallback: null,
      });
      listeners[1]?.onEvent({ kind: 'ready' });
    });
    expect(session.store.getState().models).toEqual([{ id: 'refreshed', label: 'Updated model' }]);
    expect(session.store.getState().draft).toBe('An unsent follow-up');
    expect(session.store.getState().queuedPrompts.map((item) => item.text)).toEqual([
      'Queued work',
    ]);
    expect(session.store.getState().queuePaused).toBe(true);
    expect(sent.filter((command) => command.kind === 'prompt')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Reconnect' })).toBeNull();
  });
});
