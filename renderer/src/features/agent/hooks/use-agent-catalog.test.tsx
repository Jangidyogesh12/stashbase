import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import type { AgentCatalog } from '@/features/agent/domain/agent-catalog';
import { agentCatalogPort, CLAUDE_AGENT } from '@/test/fakes/agent';
import { createTestQueryClient, queryWrapper } from '@/test/query';

import { useAgentCatalog } from './use-agent-catalog';

const checking: AgentCatalog = {
  agents: [{ ...CLAUDE_AGENT, ready: false, preparation: { step: 'check' } }],
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function observe(listAgents: ReturnType<typeof agentCatalogPort>['listAgents']) {
  vi.useFakeTimers();
  const hook = renderHook(() => useAgentCatalog(agentCatalogPort([], { listAgents })), {
    wrapper: queryWrapper(createTestQueryClient()),
  });
  await advance(1);
  expect(hook.result.current.loading).toBe(false);
  return hook;
}

async function advance(ms = 1_000) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('Agent catalog preparation', () => {
  it.each([
    { ...CLAUDE_AGENT },
    { ...CLAUDE_AGENT, ready: false },
    { ...CLAUDE_AGENT, ready: false, needsSignIn: true },
    {
      ...CLAUDE_AGENT,
      ready: false,
      setupFailure: { stage: 'mcp' as const, message: 'Could not connect MCP.' },
    },
  ])(
    'follows preparation until it settles: $ready / $needsSignIn / $setupFailure',
    async (settled) => {
      const listAgents = vi.fn().mockResolvedValue(checking);
      const hook = await observe(listAgents);

      listAgents.mockResolvedValue({ agents: [settled] });
      await advance();
      expect(hook.result.current.agents).toEqual([settled]);
      const reads = listAgents.mock.calls.length;
      await advance(30_000);
      expect(listAgents).toHaveBeenCalledTimes(reads);
    },
  );

  it('stops on a failed read and resumes preparation through Retry', async () => {
    const listAgents = vi.fn().mockResolvedValue(checking);
    const hook = await observe(listAgents);

    listAgents.mockRejectedValue(new Error('The service is unavailable.'));
    await advance();
    expect(hook.result.current.error).toBe(true);
    expect(hook.result.current.agents).toEqual(checking.agents);
    const failedReads = listAgents.mock.calls.length;
    await advance(30_000);
    expect(listAgents).toHaveBeenCalledTimes(failedReads);

    listAgents.mockResolvedValue(checking);
    act(() => hook.result.current.refresh());
    await advance();
    expect(hook.result.current.error).toBe(false);
    listAgents.mockResolvedValue({ agents: [CLAUDE_AGENT] });
    await advance();
    expect(hook.result.current.readyAgents).toEqual([CLAUDE_AGENT]);
  });

  it('retires an outstanding preparation read when its last observer leaves', async () => {
    const listAgents = vi.fn().mockResolvedValue(checking);
    const hook = await observe(listAgents);

    let signal: AbortSignal | undefined;
    listAgents.mockImplementation((next: AbortSignal) => {
      signal = next;
      return new Promise<AgentCatalog>(() => {});
    });
    await advance();
    expect(signal?.aborted).toBe(false);
    hook.unmount();
    expect(signal?.aborted).toBe(true);
    const reads = listAgents.mock.calls.length;
    await advance(30_000);
    expect(listAgents).toHaveBeenCalledTimes(reads);
  });
});
