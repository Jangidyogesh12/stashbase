import { afterEach, expect, it, vi } from 'vite-plus/test';

import { agentSessionPort } from '@/test/fakes/agent';

import { observeAgentOutcomes } from './outcome-notifications';
import { createAgentWorkspaceRuntime } from './workspace-runtime';

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Expected a fixture value');
  return value;
}

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const stop of cleanup.splice(0)) stop();
});
function fixture(ready = true) {
  const transport = agentSessionPort();
  let id = 0;
  const runtime = createAgentWorkspaceRuntime({
    createId: () => `chat-${++id}`,
    folderPath: '/project',
    port: transport.port,
  });
  const session = runtime.activeSession();
  const publish = vi.fn<Parameters<typeof observeAgentOutcomes>[1]>();
  const outcomes = observeAgentOutcomes(runtime, publish);
  if (ready) {
    session.start();
    transport.listeners[0]?.onEvent({ kind: 'ready' });
  }
  cleanup.push(() => {
    outcomes.dispose();
    runtime.dispose();
  });
  return {
    runtime,
    session,
    get listener() {
      return required(transport.listeners[0]);
    },
    outcomes,
    publish,
    latest: () => publish.mock.calls.at(-1)?.[0] ?? [],
  };
}

it('announces inactive live turns once, separates retry outcomes, and activates the matching result', async () => {
  const h = fixture();
  h.session.setDraft('Write a paragraph');
  await h.session.sendPrompt();
  h.runtime.newChat();
  h.listener.onEvent({ kind: 'failed', message: 'Try later', failure: 'network' });
  const failure = required(h.latest()[0]);
  expect(failure.kind).toBe('agent-failed');
  expect(h.outcomes.activate('agent-completed', failure.id)).toBe(false);
  const error = required(
    h.session.store.getState().transcript.findLast((block) => block.kind === 'error'),
  );
  expect(failure.blockId).toBe(error.id);
  h.listener.onEvent({ kind: 'turn-ended', isError: true });
  expect(h.latest()).toEqual([failure]);
  expect(h.session.retry(error.id)).toBe(true);
  h.listener.onEvent({ kind: 'text', delta: 'Finished paragraph.' });
  h.listener.onEvent({ kind: 'turn-ended', isError: false });
  const complete = required(h.latest()[0]);
  expect(complete.kind).toBe('agent-completed');
  expect(complete.id).not.toBe(failure.id);
  expect(h.outcomes.activate('agent-failed', failure.id)).toBe(false);
  expect(h.outcomes.activate('agent-completed', complete.id)).toBe(true);
  expect(h.runtime.activeSession()).toBe(h.session);
  expect(h.runtime.store.getState().attentionTarget).toEqual({
    sessionId: h.session.id,
    blockId: complete.blockId,
  });
  expect(h.latest()).toEqual([]);
  h.listener.onEvent({ kind: 'turn-ended', isError: false });
  expect(h.latest()).toEqual([]);
});

it('does not replay history or announce a user stop, even if cancellation later times out or fails', async () => {
  vi.useFakeTimers();
  try {
    const h = fixture();
    h.session.store.setState({
      delivery: 'completed',
      transcript: [{ kind: 'assistant', id: 'history', text: 'An old result' }],
    });
    expect(h.latest()).toEqual([]);
    h.session.setDraft('Task to stop');
    await h.session.sendPrompt();
    expect(h.session.interrupt()).toBe(true);
    vi.advanceTimersByTime(15_000);
    h.listener.onEvent({
      kind: 'failed',
      failure: 'network',
      message: 'Connection closed while cancelling',
    });
    h.listener.onEvent({ kind: 'turn-ended', isError: false });
    expect(h.latest()).toEqual([]);
  } finally {
    vi.useRealTimers();
  }
});

it('reports unexpected disconnect once and revokes closed or retired chat targets', async () => {
  const h = fixture();
  h.session.setDraft('A running task');
  await h.session.sendPrompt();
  h.listener.onEvent({ kind: 'exited', message: 'Process exited' });
  const outcome = required(h.latest()[0]);
  expect(outcome.kind).toBe('agent-failed');
  h.runtime.close(h.session.id);
  expect(h.latest()).toEqual([]);
  expect(h.outcomes.activate(outcome.kind, outcome.id)).toBe(false);
});

it('keeps a queued turn result while the next turn runs and replaces it only on its outcome', async () => {
  const h = fixture();
  h.session.setDraft('First');
  await h.session.sendPrompt();
  h.listener.onEvent({ kind: 'text', delta: 'First result' });
  h.session.setDraft('Second');
  h.session.setQueue([{ id: 'queued', text: 'Second' }]);
  h.listener.onEvent({ kind: 'turn-ended', isError: false });
  const first = required(h.latest()[0]);
  await vi.waitFor(() => expect(h.session.store.getState().queuedPrompts).toEqual([]));
  expect(h.latest()).toEqual([first]);
  h.listener.onEvent({ kind: 'turn-ended', isError: true });
  expect(h.latest()[0]?.kind).toBe('agent-failed');
  expect(h.latest()[0]?.id).not.toBe(first.id);
});

it('announces submitted startup failure, but not idle connection failure or stopping startup', async () => {
  const h = fixture(false);
  h.session.setDraft('Start a task');
  await h.session.sendPrompt();
  h.listener.onEvent({ kind: 'failed', message: 'Could not start', failure: 'network' });
  await Promise.resolve();
  const failure = required(h.latest()[0]);
  expect(failure.kind).toBe('agent-failed');
  expect(failure.blockId).toBeNull();
  expect(h.outcomes.activate(failure.kind, failure.id)).toBe(true);
  const stopping = fixture(false);
  stopping.session.setDraft('A startup to stop');
  await stopping.session.sendPrompt();
  expect(stopping.session.interrupt()).toBe(true);
  await Promise.resolve();
  expect(stopping.latest()).toEqual([]);
  const idle = fixture();
  idle.listener.onEvent({ kind: 'failed', message: 'Idle failure', failure: 'network' });
  expect(idle.latest()).toEqual([]);
});
