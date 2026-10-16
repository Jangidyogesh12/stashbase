import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vite-plus/test';

import { Providers } from '@/app/providers';
import { App } from '@/app/shell';
import type { UpdatesPort } from '@/features/updates/public';
import { appDependencies } from '@/test/fakes/app';

afterEach(cleanup);

const read: UpdatesPort['read'] = async () => ({
  ok: true,
  state: {
    autoCheckEnabled: true,
    currentVersion: '2.8.0',
    status: { phase: 'ready', version: '2.8.1' },
  },
});

it('closes Developer tools and previews installation in the sidebar without invoking the updater', async () => {
  const primary = vi.fn(read);
  const release = vi.fn(read);
  const updates: UpdatesPort = {
    check: read,
    openReleasePage: release,
    read,
    runPrimaryAction: primary,
    setAutoCheck: read,
    subscribe: () => () => undefined,
  };
  const user = userEvent.setup();
  render(
    <Providers>
      <App dependencies={appDependencies({ updates })} />
    </Providers>,
  );
  await user.click(await screen.findByRole('button', { name: 'Settings' }));
  fireEvent.keyDown(document, {
    key: 'D',
    code: 'KeyD',
    ctrlKey: true,
    altKey: true,
    shiftKey: true,
  });
  await screen.findByRole('dialog', { name: 'Developer tools' });
  await user.click(screen.getByRole('button', { name: 'Preview in sidebar' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Developer tools' })).toBeNull());
  const label = await screen.findByText('Update preview');
  const footer = label.closest<HTMLElement>('[data-sidebar="footer"]');
  expect(footer).not.toBeNull();
  if (!footer) throw new Error('Preview is not in the sidebar footer');
  expect(within(footer).getByText('StashBase 9.9.9 is ready to install.')).not.toBeNull();
  await user.click(screen.getByRole('button', { name: 'Restart to update' }));
  expect(primary).not.toHaveBeenCalled();
  expect(release).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Dismiss update notification' }));
  expect(screen.queryByText('Update preview')).toBeNull();
  expect(screen.getByText('StashBase 2.8.1 is ready to install.')).not.toBeNull();
  await user.click(screen.getByRole('button', { name: 'Restart to update' }));
  await waitFor(() => expect(primary).toHaveBeenCalledOnce());
}, 20_000);
