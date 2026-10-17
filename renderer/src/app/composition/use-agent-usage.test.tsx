import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vite-plus/test';

import { Providers } from '@/app/providers';
import { SidebarMenu } from '@/components/ui/sidebar-menu';
import { AccountProvider, SidebarAccountRow } from '@/features/settings/public';
import {
  accountPort,
  agentRuntimePort,
  IDLE_ALLOWANCE,
  SIGNED_IN_ACCOUNT,
} from '@/test/fakes/settings';

import { useAgentUsage } from './use-agent-usage';

afterEach(cleanup);

it('refreshes visible credits when a Default turn fails even if telemetry does nothing', async () => {
  let remainingPercent = 78;
  const getAllowance = vi.fn(async () => ({ ...IDLE_ALLOWANCE, remainingPercent }));
  const port = agentRuntimePort({ getAllowance });
  const record = vi.fn();
  let report: ReturnType<typeof useAgentUsage> = vi.fn();
  function Surface() {
    report = useAgentUsage(record);
    return (
      <SidebarMenu>
        <SidebarAccountRow
          agentRuntimeApi={port}
          onOpenPlans={() => {}}
          onOpenSettings={() => {}}
        />
      </SidebarMenu>
    );
  }
  render(
    <Providers>
      <AccountProvider port={accountPort(SIGNED_IN_ACCOUNT)} openExternal={() => {}}>
        <Surface />
      </AccountProvider>
    </Providers>,
  );
  await userEvent
    .setup()
    .click(await screen.findByRole('button', { name: 'Account: Ada Lovelace' }));
  expect(await screen.findByText('78%')).not.toBeNull();
  remainingPercent = 15;
  act(() =>
    report({
      event: 'agent_turn_finished',
      runtime: 'stashbase',
      outcome: 'failed',
      duration: 'over_5m',
    }),
  );
  await waitFor(() => expect(screen.getByText('15%')).not.toBeNull());
  const calls = getAllowance.mock.calls.length;
  act(() =>
    report({
      event: 'agent_turn_finished',
      runtime: 'codex',
      outcome: 'success',
      duration: 'under_10s',
    }),
  );
  expect(getAllowance).toHaveBeenCalledTimes(calls);
  expect(record).toHaveBeenCalledTimes(2);
});
