import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vite-plus/test';

import type { AgentTool, AgentToolsPort } from '@/features/agent/application/ports';
import { agentToolsApi } from '@/test/fakes/agent';
import { createRetainingTestQueryClient, queryWrapper } from '@/test/query';

import { useAgentTools } from './use-agent-tools';

afterEach(cleanup);

async function fixture() {
  const rows = await agentToolsApi().list(new AbortController().signal, 'a');
  let resolve!: (rows: readonly AgentTool[]) => void;
  let reject!: (error: Error) => void;
  const save = vi.fn(
    () =>
      new Promise<readonly AgentTool[]>((yes, no) => {
        resolve = yes;
        reject = no;
      }),
  );
  const port: AgentToolsPort = { list: vi.fn(async () => rows), set: save };
  const client = createRetainingTestQueryClient();
  const applied = vi.fn();
  const hook = renderHook(({ chat }) => useAgentTools(port, chat, () => applied(chat)), {
    initialProps: { chat: 'a' },
    wrapper: queryWrapper(client),
  });
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return {
    hook,
    client,
    applied,
    save,
    rows,
    succeed: () =>
      resolve(
        rows.map((row) => (row.id === 'writer' ? Object.assign({}, row, { enabled: true }) : row)),
      ),
    fail: () => reject(new Error('Save refused')),
  };
}

it('keeps one save in flight, restores a refused selection and allows retry', async () => {
  const f = await fixture();
  act(() => {
    f.hook.result.current.change('writer', { enabled: true });
    f.hook.result.current.change('reader', { enabled: true });
  });
  await waitFor(() => expect(f.save).toHaveBeenCalledTimes(1));
  expect(f.hook.result.current.saving).toBe(true);
  await act(async () => f.fail());
  await waitFor(() => expect(f.hook.result.current.error).toContain('could not be saved'));
  expect(f.hook.result.current.tools.find((row) => row.id === 'writer')?.enabled).toBe(false);
  expect(f.applied).not.toHaveBeenCalled();
  act(() => f.hook.result.current.change('writer', { enabled: true }));
  await waitFor(() => expect(f.save).toHaveBeenCalledTimes(2));
  await act(async () => f.succeed());
  await waitFor(() => expect(f.applied).toHaveBeenCalledWith('a'));
});

it('a late save updates and reconnects only the chat that made it', async () => {
  const f = await fixture();
  act(() => f.hook.result.current.change('writer', { enabled: true }));
  await waitFor(() => expect(f.save).toHaveBeenCalledTimes(1));
  f.hook.rerender({ chat: 'b' });
  await waitFor(() => expect(f.hook.result.current.loading).toBe(false));
  await act(async () => f.succeed());
  await waitFor(() => expect(f.applied).toHaveBeenCalledWith('a'));
  expect(f.hook.result.current.tools.find((row) => row.id === 'writer')?.enabled).toBe(false);
  expect(
    f.client
      .getQueryData<readonly AgentTool[]>(['agent-tools', 'a'])
      ?.find((row) => row.id === 'writer')?.enabled,
  ).toBe(true);
});
