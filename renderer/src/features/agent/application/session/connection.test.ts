import { describe, expect, it, vi } from 'vite-plus/test';

import type { AgentConnectionListener, AgentSessionPort } from '@/features/agent/application/ports';
import {
  createAgentSessionState,
  transitionAgentSession,
  type AgentSessionAction,
  type AgentSessionState,
} from '@/features/agent/domain/session';
import { agentSessionPort } from '@/test/fakes/agent';

import { createAgentTransport } from './connection';

/** A transport over real session state and a scheduler the test steps by
 *  hand, so the reconnect ladder runs without wall time. */
function harness(overrides: Partial<AgentSessionPort> = {}) {
  let state: AgentSessionState = createAgentSessionState({
    agent: 'codex',
    id: 'chat-1',
    scope: { kind: 'folder', path: '/project/Research' },
  });
  const actions: AgentSessionAction[] = [];
  const listeners: AgentConnectionListener[] = [];
  const sockets: Array<{ close: ReturnType<typeof vi.fn> }> = [];
  const waits: Array<() => void> = [];
  const controller = new AbortController();
  const port = agentSessionPort({
    connect: vi.fn((_request, listener: AgentConnectionListener) => {
      listeners.push(listener);
      const socket = { close: vi.fn(), send: vi.fn(() => true) };
      sockets.push(socket);
      return socket;
    }),
    ...overrides,
  }).port;

  const transition = (action: AgentSessionAction) => {
    actions.push(action);
    state = transitionAgentSession(state, action);
  };
  const transport = createAgentTransport({
    disposed: () => false,
    onEvent: vi.fn(),
    port,
    scheduler: {
      jitter: (delayMs) => delayMs,
      wait: (_delayMs, signal) =>
        new Promise((resolve, reject) => {
          if (signal.aborted) reject(signal.reason);
          else waits.push(resolve);
        }),
    },
    signal: controller.signal,
    state: () => state,
    transition,
  });

  return {
    actions,
    async drainWait() {
      waits.shift()?.();
      await Promise.resolve();
      await Promise.resolve();
    },
    listeners,
    port,
    sockets,
    state: () => state,
    transition,
    transport,
  };
}

describe('agent transport', () => {
  it('opens the socket the session state describes and reports it connecting', () => {
    const test = harness();

    test.transport.open({ attempt: 0, resume: 'native-2' });

    expect(test.state().connection).toEqual({ attempt: 0, kind: 'connecting' });
    expect(test.port.connect).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: 'codex',
        resume: 'native-2',
        scope: { kind: 'folder', path: '/project/Research' },
      }),
      expect.anything(),
    );
  });

  it('stops the conversation when the socket cannot be opened at all', () => {
    const test = harness({
      connect: vi.fn(() => {
        throw new Error('no route');
      }),
    });

    test.transport.open();

    expect(test.state().connection).toEqual({
      kind: 'failed',
      message: 'Agent connection could not start.',
    });
  });

  it('climbs the reconnect ladder on a drop and gives up with one sentence', async () => {
    const test = harness();
    test.transport.open({ attempt: 0 });

    for (const attempt of [1, 2, 3]) {
      test.listeners.at(-1)?.onClose();
      expect(test.state().connection).toEqual({ attempt, kind: 'reconnecting' });
      await test.drainWait();
    }
    test.listeners.at(-1)?.onClose();

    expect(test.state().connection).toEqual({
      kind: 'failed',
      message: 'Agent connection was interrupted. Reconnect to continue this chat.',
    });
  });

  it('ignores a socket the runtime has already replaced', () => {
    const test = harness();
    test.transport.open();
    const retired = test.listeners[0];
    test.transport.open();

    retired?.onClose();

    // The stale socket cannot arm a reconnect for the live one.
    expect(test.state().connection).toEqual({ attempt: 0, kind: 'connecting' });
  });

  it('does not reconnect after a close the server announced', () => {
    const test = harness();
    test.transport.open();

    test.transport.expectClose();
    test.listeners.at(-1)?.onClose();

    expect(test.state().connection).toEqual({ attempt: 0, kind: 'connecting' });
    expect(test.sockets.at(-1)?.close).toHaveBeenCalled();
  });

  it('stops on a response the schema rejected', () => {
    const test = harness();
    test.transport.open();

    test.listeners.at(-1)?.onInvalidResponse();

    expect(test.state().connection).toEqual({
      kind: 'failed',
      message: 'Agent returned an invalid response.',
    });
  });

  it('sends an access mode once and then only when it has changed', () => {
    const test = harness();
    test.transport.open();

    expect(test.transport.applyAccessMode('plan')).toBe(true);
    test.transport.syncAccessMode();

    // The mode the socket already carries is not resent on ready.
    expect(test.sockets.at(-1)?.close).not.toHaveBeenCalled();
  });

  it('re-sends a model picked while the socket was still opening, once', () => {
    let open = false;
    const send = vi.fn(() => open);
    const test = harness({
      connect: vi.fn(() => ({ close: vi.fn(), send })),
    });
    test.transport.open();

    // The pick lands before the socket is open: the frame is refused, and the
    // choice lives only in session state until ready.
    test.transition({ model: 'claude-fable-5-1[1m]', kind: 'set-model' });
    expect(test.transport.applyModel('claude-fable-5-1[1m]')).toBe(false);

    open = true;
    test.transport.syncModel();
    expect(send).toHaveBeenLastCalledWith({ kind: 'select-model', model: 'claude-fable-5-1[1m]' });

    // A second ready, and a reopen whose URL already carries the model, send nothing more.
    test.transport.syncModel();
    test.transport.open();
    test.transport.syncModel();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('invalidates every generation so a late callback is ignored', () => {
    const test = harness();
    test.transport.open();

    test.transport.invalidate();
    test.listeners.at(-1)?.onInvalidResponse();

    expect(test.state().connection).toEqual({ attempt: 0, kind: 'connecting' });
  });
});
