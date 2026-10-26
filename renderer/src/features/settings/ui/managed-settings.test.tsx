import { cleanup, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vite-plus/test';

import { AccountProvider } from '@/features/settings/ui/account/account-provider';
import {
  accountPort,
  agentRuntimePort,
  appearancePort,
  embedderPort,
  mcpAccessPort,
} from '@/test/fakes/settings';
import { withQueryClient } from '@/test/query';

import ManagedSettings from './managed-settings';
import type { SettingsTarget } from './settings-types';

afterEach(cleanup);

const appearance = appearancePort();

function Harness({ initial = 'general' }: { initial?: SettingsTarget }) {
  const [section, setSection] = useState<SettingsTarget>(initial);
  return (
    <AccountProvider port={accountPort()} openExternal={vi.fn()}>
      <ManagedSettings
        agentRuntimeApi={agentRuntimePort()}
        appearanceApi={appearance}
        embedderApi={embedderPort()}
        mcpAccessApi={mcpAccessPort()}
        onClose={vi.fn()}
        onSectionChange={setSection}
        open
        section={section}
      />
    </AccountProvider>
  );
}

it('separates preferences and routes account access without losing saved editor choices', async () => {
  withQueryClient(<Harness />);
  const user = userEvent.setup();
  const nav = screen.getByLabelText('Settings sections');
  expect(within(nav).getAllByRole('button')).toHaveLength(7);
  for (const name of [
    'Account',
    'Appearance',
    'Editor',
    'Agents',
    'Notifications',
    'General',
    'Advanced',
  ]) {
    expect(within(nav).getByRole('button', { name: new RegExp(name) })).toBeDefined();
  }
  expect(screen.queryByRole('radiogroup', { name: 'Mode' })).toBeNull();
  await user.click(within(nav).getByRole('button', { name: 'Appearance' }));
  await screen.findByRole('radiogroup', { name: 'Mode' });
  expect(screen.queryByRole('radiogroup', { name: 'Line width' })).toBeNull();
  await user.click(within(nav).getByRole('button', { name: 'Editor' }));
  const width = await screen.findByRole('radiogroup', { name: 'Line width' });
  await user.click(within(width).getByRole('radio', { name: 'Wide' }));
  await waitFor(() =>
    expect(appearance.update).toHaveBeenCalledWith({ lineWidth: 'wide' }, expect.any(AbortSignal)),
  );
  await user.click(within(nav).getByRole('button', { name: 'Appearance' }));
  await user.click(within(nav).getByRole('button', { name: 'Editor' }));
  expect(
    within(await screen.findByRole('radiogroup', { name: 'Line width' })).getByRole('radio', {
      name: 'Wide',
    }),
  ).toHaveProperty('checked', true);
  await user.click(within(nav).getByRole('button', { name: 'Agents' }));
  await user.click(await screen.findByRole('button', { name: 'Open account' }));
  await screen.findByRole('heading', { name: 'Account' });
  expect(screen.queryByText('Your agents')).toBeNull();
  await user.click(within(nav).getByRole('button', { name: 'Advanced' }));
  await user.click(screen.getByRole('button', { name: 'Configure search by meaning' }));
  await screen.findByPlaceholderText('Paste your API key');
  await user.click(screen.getByRole('button', { name: 'Back to Advanced' }));
  await user.click(screen.getByRole('button', { name: 'Configure external apps' }));
  await screen.findByRole('button', { name: 'Copy configuration' });
  expect(screen.queryByRole('button', { name: 'Show token' })).toBeNull();
  await user.click(screen.getByRole('tab', { name: 'URL' }));
  expect(screen.getByRole('button', { name: 'Show token' })).toBeDefined();
});

it('opens the search configuration directly and can return to the Advanced index', async () => {
  withQueryClient(<Harness initial="search" />);
  await screen.findByPlaceholderText('Paste your API key');
  await userEvent.setup().click(screen.getByRole('button', { name: 'Back to Advanced' }));
  expect(screen.getByRole('button', { name: 'Configure external apps' })).toBeDefined();
});
