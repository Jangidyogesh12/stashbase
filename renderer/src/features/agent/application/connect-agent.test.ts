import { expect, it, vi } from 'vite-plus/test';

import { agentCatalogPort, CLAUDE_AGENT } from '@/test/fakes/agent';

import { connectAgent, updateAgent } from './connect-agent';
import { agentUpdateFailure } from './failure-messages';

const immediately = async () => undefined;

it('continues a fresh Claude installation through provider sign-in before readiness', async () => {
  const signedOut = { ...CLAUDE_AGENT, ready: false, needsSignIn: true };
  const prepareAgent = vi
    .fn()
    .mockResolvedValueOnce({ agents: [signedOut] })
    .mockResolvedValueOnce({ agents: [{ ...CLAUDE_AGENT, ready: true }] });
  const port = agentCatalogPort([], { prepareAgent });
  await connectAgent(port, 'claude', undefined, new AbortController().signal, {
    wait: immediately,
  });
  expect(prepareAgent.mock.calls.map(([, action]) => action)).toEqual(['bootstrap', 'login']);
});

it('follows a sign-in already running instead of asking for a second one', async () => {
  const signingIn = {
    step: 'sign-in' as const,
    note: 'Finish signing in to Claude in your browser.',
  };
  const running = { ...CLAUDE_AGENT, ready: false, preparation: signingIn };
  const prepareAgent = vi.fn();
  const port = agentCatalogPort([], {
    prepareAgent,
    listAgents: vi
      .fn()
      .mockResolvedValueOnce({ agents: [running] })
      .mockResolvedValueOnce({ agents: [{ ...CLAUDE_AGENT, ready: true }] }),
  });
  await connectAgent(port, 'claude', running, new AbortController().signal, { wait: immediately });
  expect(prepareAgent).not.toHaveBeenCalled();

  // One that ended signed out goes on to a sign-in of the reader's own.
  const signedOut = { ...CLAUDE_AGENT, ready: false, needsSignIn: true };
  const login = vi.fn(async (_agent: string, _action: string) => ({
    agents: [{ ...CLAUDE_AGENT, ready: true }],
  }));
  await connectAgent(
    agentCatalogPort([], {
      prepareAgent: login,
      listAgents: vi.fn(async () => ({ agents: [signedOut] })),
    }),
    'claude',
    running,
    new AbortController().signal,
    { wait: immediately },
  );
  expect(login.mock.calls.map(([, action]) => action)).toEqual(['login']);
});

it('reports a followed sign-in that was stopped instead of opening another', async () => {
  const signingIn = {
    step: 'sign-in' as const,
    note: 'Finish signing in to Claude in your browser.',
  };
  const running = { ...CLAUDE_AGENT, ready: false, preparation: signingIn };
  const stopped = {
    ...CLAUDE_AGENT,
    ready: false,
    needsSignIn: true,
    setupFailure: { stage: 'authentication' as const, message: 'Claude sign-in was stopped.' },
  };
  const prepareAgent = vi.fn();
  const port = agentCatalogPort([], {
    prepareAgent,
    listAgents: vi
      .fn()
      .mockResolvedValueOnce({ agents: [running] })
      .mockResolvedValueOnce({ agents: [stopped] }),
  });

  await expect(
    connectAgent(port, 'claude', running, new AbortController().signal, { wait: immediately }),
  ).rejects.toMatchObject({ setup: stopped.setupFailure });
  expect(prepareAgent).not.toHaveBeenCalled();
});

it('reports each step the service reaches until the runtime is ready', async () => {
  const installing = { step: 'install' as const, note: 'Downloading Codex CLI…' };
  const signingIn = {
    step: 'sign-in' as const,
    note: 'Finish signing in to Codex in your browser.',
    signInUrl: 'https://auth.example.com/oauth/authorize',
  };
  const port = agentCatalogPort([], {
    prepareAgent: vi.fn(async () => ({
      agents: [{ ...CLAUDE_AGENT, ready: false, preparation: installing }],
    })),
    listAgents: vi
      .fn()
      .mockResolvedValueOnce({
        agents: [{ ...CLAUDE_AGENT, ready: false, preparation: signingIn }],
      })
      .mockResolvedValueOnce({ agents: [{ ...CLAUDE_AGENT, ready: true }] }),
  });
  const onStep = vi.fn();
  await connectAgent(port, 'claude', undefined, new AbortController().signal, {
    onStep,
    wait: immediately,
  });
  expect(onStep.mock.calls.map(([step]) => step)).toEqual([installing, signingIn]);
});

it('follows the update acknowledgement until the runtime is ready again, reporting each step', async () => {
  const downloading = {
    step: 'install' as const,
    note: 'Downloading the official Claude installer…',
  };
  const preparing = { ...CLAUDE_AGENT, preparation: downloading, ready: false };
  const ready = { ...CLAUDE_AGENT, ready: true };
  const port = agentCatalogPort([ready], {
    prepareAgent: vi.fn(async () => ({ agents: [preparing] })),
  });
  const onStep = vi.fn();

  await expect(
    updateAgent(port, 'claude', new AbortController().signal, { onStep, wait: immediately }),
  ).resolves.toBeUndefined();

  expect(port.prepareAgent).toHaveBeenCalledWith('claude', 'update', expect.anything());
  expect(port.listAgents).toHaveBeenCalledOnce();
  expect(onStep.mock.calls.map(([step]) => step)).toEqual([downloading]);
});

it("reports the service's own sentence when the update does not end ready", async () => {
  const failed = {
    ...CLAUDE_AGENT,
    ready: false,
    setupFailure: { stage: 'installation' as const, message: 'npm global folder is not writable' },
  };
  const port = agentCatalogPort([failed], {
    prepareAgent: vi.fn(async () => ({ agents: [failed] })),
  });

  await expect(
    updateAgent(port, 'claude', new AbortController().signal, { wait: immediately }),
  ).rejects.toSatisfy((error) => agentUpdateFailure(error) === 'npm global folder is not writable');
});
