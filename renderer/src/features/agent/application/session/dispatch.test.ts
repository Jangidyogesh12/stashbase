import { describe, expect, it, vi } from 'vite-plus/test';

import { AgentContextError } from '@/features/agent/application/ports';
import type { AgentContextItem } from '@/features/agent/domain/context';
import {
  createAgentSessionState,
  transitionAgentSession,
  type AgentSessionState,
} from '@/features/agent/domain/session';
import { agentContextPort } from '@/test/fakes/agent';

import {
  createPromptDispatcher,
  unavailableContextPort,
  type AgentSessionEnvironment,
} from './dispatch';
import { createPromptLedger } from './prompts';

const RESEARCH = { kind: 'folder', path: '/project/Research' } as const;
const report: AgentContextItem = {
  boundVersion: 4,
  format: 'md',
  kind: 'source',
  source: { folderPath: RESEARCH.path, path: 'report.md' },
};

const environment: AgentSessionEnvironment = {
  listing: { files: [{ format: 'md', path: 'report.md' }], folders: [] },
  readiness: {},
};

function harness(
  options: { contextPort?: Parameters<typeof createPromptDispatcher>[0]['contextPort'] } = {},
) {
  let state: AgentSessionState = createAgentSessionState({
    agent: 'codex',
    id: 'chat-1',
    scope: RESEARCH,
  });
  let disposed = false;
  const submit = vi.fn(() => true);
  const start = vi.fn();
  const dispatcher = createPromptDispatcher({
    contextPort: options.contextPort ?? agentContextPort(),
    disposed: () => disposed,
    environment: () => environment,
    ledger: createPromptLedger(),
    signal: new AbortController().signal,
    start,
    state: () => state,
    submit,
    transientFiles: new Map(),
    transition: (action) => {
      state = transitionAgentSession(state, action);
    },
  });
  return {
    dispatcher,
    dispose: () => {
      disposed = true;
    },
    goLive: () => {
      state = transitionAgentSession(state, { kind: 'ready' });
    },
    setState: (patch: Partial<AgentSessionState>) => {
      state = { ...state, ...patch };
    },
    start,
    state: () => state,
    submit,
  };
}

describe('prompt dispatcher', () => {
  it('refuses a send with nothing to say', async () => {
    const test = harness();

    await expect(test.dispatcher.send('   ')).resolves.toEqual({ ok: false, reason: 'empty' });
    expect(test.submit).not.toHaveBeenCalled();
  });

  it('opens the transport for the first prompt of a draft and holds it', async () => {
    const test = harness();

    await expect(test.dispatcher.send('Map the repo')).resolves.toEqual({ ok: true });

    expect(test.start).toHaveBeenCalledOnce();
    expect(test.submit).not.toHaveBeenCalled();
    expect(test.state().draft).toBe('Map the repo');
  });

  it('puts a prompt on a live socket with its bound context rendered in', async () => {
    const test = harness();
    test.goLive();
    test.setState({ context: [report] });

    await expect(test.dispatcher.send('Summarise it')).resolves.toEqual({ ok: true });

    expect(test.submit).toHaveBeenCalledWith(
      expect.objectContaining({ context: [report], display: 'Summarise it' }),
    );
  });

  it('refuses bound context the folder no longer offers', async () => {
    const test = harness();
    test.goLive();
    test.setState({
      context: [{ ...report, source: { folderPath: RESEARCH.path, path: 'gone.md' } }],
    });

    await expect(test.dispatcher.send('Summarise it')).resolves.toEqual({
      ok: false,
      reason: 'stale',
    });
    expect(test.state().contextIssue).not.toBeNull();
  });

  it('treats a source the server no longer has as a stale send', async () => {
    const test = harness({
      contextPort: agentContextPort({
        resolve: vi.fn(() => Promise.reject(new AgentContextError('not-found', 'gone'))),
      }),
    });
    test.goLive();
    test.setState({ context: [report] });

    await expect(test.dispatcher.send('Summarise it')).resolves.toEqual({
      ok: false,
      reason: 'stale',
    });
    expect(test.state().contextIssue).toBe('That file is no longer in this folder.');
  });

  it('refuses to send while a turn is already running', async () => {
    const test = harness();
    test.setState({ connection: { kind: 'live', turn: { promptBlockId: 'u1' } } });

    await expect(test.dispatcher.send('Again')).resolves.toEqual({ ok: false, reason: 'busy' });
  });

  it('binds every uploaded file and names how many were refused', async () => {
    const test = harness({
      contextPort: agentContextPort({
        upload: vi.fn(async () => [
          { name: 'ok.png', path: '/tmp/ok.png' },
          { error: 'too large', name: 'huge.png' },
        ]),
      }),
    });

    await test.dispatcher.attach([new File(['a'], 'ok.png'), new File(['b'], 'huge.png')]);

    expect(test.state().context).toEqual([
      { kind: 'transient', name: 'ok.png', path: '/tmp/ok.png' },
    ]);
    expect(test.state().contextIssue).toBe('1 file could not be attached.');
  });

  it('reports an upload the transport refused on the failure ladder', async () => {
    const test = harness({
      contextPort: agentContextPort({
        upload: vi.fn(() => Promise.reject(new AgentContextError('unavailable', 'offline'))),
      }),
    });

    await test.dispatcher.attach([new File(['a'], 'ok.png')]);

    expect(test.state().contextIssue).toBe('StashBase could not reach the agent service.');
  });
});

describe('unavailableContextPort', () => {
  it('refuses every call on the same ladder a real port fails on', async () => {
    const port = unavailableContextPort();

    await expect(
      port.resolve({ folderPath: '/project', path: 'a.md' }, new AbortController().signal),
    ).rejects.toMatchObject({ kind: 'unavailable' });
    await expect(port.upload([], new AbortController().signal, '/project')).rejects.toMatchObject({
      kind: 'unavailable',
    });
  });
});
