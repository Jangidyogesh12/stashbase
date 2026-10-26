import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { failureMessage } from '@/features/settings/application/failure-messages';
import { type AccountPort, type AgentRuntimePort } from '@/features/settings/application/ports';
import type { AgentCatalog, AgentRuntime } from '@/features/settings/domain/agent-catalog';
import { AccountProvider } from '@/features/settings/ui/account/account-provider';
import { accountPort, agentRuntime, agentRuntimePort } from '@/test/fakes/settings';
import { withQueryClient } from '@/test/query';

import { AgentRuntimesPanel } from './agents-panel';

function catalog(runtimes: AgentRuntime[], debug?: AgentCatalog['debug']): AgentCatalog {
  return { runtimes, debug: debug ?? null };
}

/** A reset runtime comes back not installed with nothing prepared for it. */

function renderPanel(
  port: AgentRuntimePort,
  account: AccountPort = accountPort(),
  onOpenExternal = vi.fn(),
) {
  const rendered = withQueryClient(
    <AccountProvider port={account} openExternal={onOpenExternal}>
      <AgentRuntimesPanel agentRuntimeApi={port} onOpenAccount={vi.fn()} />
    </AccountProvider>,
  );
  return { ...rendered, onOpenExternal };
}

afterEach(cleanup);

const codex = agentRuntime({
  id: 'codex',
  installed: false,
  label: 'Codex',
  ownership: null,
  preparation: { kind: 'idle' },
});

describe('AgentRuntimesPanel', () => {
  it('installs a not-yet-installed runtime and writes the response into the catalog', async () => {
    const port = agentRuntimePort({
      listAgents: vi.fn(async () => catalog([codex])),
      prepareAgent: vi.fn(async () =>
        catalog([
          { ...codex, installed: true, ownership: 'system', preparation: { kind: 'ready' } },
        ]),
      ),
    });
    renderPanel(port);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Install' }));

    expect(port.prepareAgent).toHaveBeenCalledWith('codex', 'bootstrap', expect.anything());
    await waitFor(() => expect(screen.getByText('Ready')).not.toBeNull());
  });

  it('updates an installed runtime in place and shows the version it came back with', async () => {
    const claude = agentRuntime({
      id: 'claude',
      installed: true,
      label: 'Claude',
      ownership: 'system',
      preparation: { kind: 'ready' },
      updatable: true,
      version: '2.1.220',
    });
    const port = agentRuntimePort({
      listAgents: vi.fn(async () => catalog([claude])),
      prepareAgent: vi.fn(async () => catalog([{ ...claude, version: '2.1.276' }])),
    });
    renderPanel(port);
    const user = userEvent.setup();

    expect(await screen.findByText('Ready · 2.1.220')).not.toBeNull();
    await user.click(await screen.findByRole('button', { name: 'Update' }));

    expect(port.prepareAgent).toHaveBeenCalledWith('claude', 'update', expect.anything());
    await waitFor(() => expect(screen.getByText(/2\.1\.276/)).not.toBeNull());
  });

  it('hides the dev-only debug block while the catalog carries no debug controls', async () => {
    const port = agentRuntimePort({ listAgents: vi.fn(async () => catalog([codex])) });
    renderPanel(port);

    await screen.findByRole('button', { name: 'Install' });
    expect(screen.queryByText('Agent setup testing')).toBeNull();
  });

  it('keeps a failed install visible on its row instead of silently clearing the busy state', async () => {
    const port = agentRuntimePort({
      listAgents: vi.fn(async () => catalog([codex])),
      prepareAgent: vi.fn(async () => {
        throw new Error('Installer exited with status 1.');
      }),
    });
    renderPanel(port);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Install' }));

    expect(await screen.findByText(failureMessage('unavailable'))).not.toBeNull();
    expect(await screen.findByRole('button', { name: 'Install' })).not.toBeNull();
  });

  it('retries a failed update as an update instead of only reconnecting the installed runtime', async () => {
    const failed = agentRuntime({
      id: 'claude',
      label: 'Claude',
      installed: true,
      updatable: true,
      preparation: {
        kind: 'failed',
        failure: {
          note: 'Could not download the official Claude installer.',
          refusal: 'operation-failed',
          stage: 'install',
          retryAction: 'update',
        },
      },
    });
    const port = agentRuntimePort({
      listAgents: vi.fn(async () => catalog([failed])),
      prepareAgent: vi.fn(async () => catalog([{ ...failed, preparation: { kind: 'ready' } }])),
    });
    renderPanel(port);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Retry' }));
    expect(port.prepareAgent).toHaveBeenCalledWith('claude', 'update', expect.anything());
    expect(await screen.findByRole('button', { name: 'Update' })).not.toBeNull();
    expect(screen.queryByText('Could not download the official Claude installer.')).toBeNull();
  });
});
