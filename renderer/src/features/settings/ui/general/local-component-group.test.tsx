import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vite-plus/test';

import type { LocalComponentPort } from '@/features/settings/application/ports';
import { settingsQueryKeys } from '@/features/settings/application/queries';
import type { LocalComponentStatus } from '@/features/settings/domain/local-component';
import { withQueryClient } from '@/test/query';

import { LocalComponentRecovery } from './local-component-recovery';

afterEach(cleanup);

it('explains an unsupported system without offering a download retry', async () => {
  const port: LocalComponentPort = {
    load: vi.fn(async () => ({ status: 'failed' as const, error: 'unsupported-system' as const })),
    retry: vi.fn(),
  };
  withQueryClient(<LocalComponentRecovery port={port} />);
  expect(await screen.findByText(/requires macOS 15 or later/)).not.toBeNull();
  expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  expect(port.retry).not.toHaveBeenCalled();
});

it('shows a failed download, retries only on click, and follows shared installation state', async () => {
  let status: LocalComponentStatus = { status: 'failed', error: 'network' };
  const port: LocalComponentPort = {
    load: vi.fn(async () => status),
    retry: vi.fn(async () => {
      status = { status: 'downloading', error: null };
      return status;
    }),
  };
  const view = withQueryClient(<LocalComponentRecovery port={port} />);
  expect(await screen.findByText(/Check your connection and retry/)).not.toBeNull();
  expect(port.retry).not.toHaveBeenCalled();
  await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText(/Downloading and installing/)).not.toBeNull();
  expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  status = { status: 'installed', error: null };
  await view.client.invalidateQueries({ queryKey: settingsQueryKeys.localComponent });
  await waitFor(() => expect(screen.queryByText('Text extraction')).toBeNull());
  expect(port.retry).toHaveBeenCalledTimes(1);
});

it('leaves an unused component alone and offers recovery for an unreadable status', async () => {
  const port: LocalComponentPort = {
    load: vi.fn(async () => ({ status: 'not-installed' as const, error: null })),
    retry: vi.fn(),
  };
  const view = withQueryClient(<LocalComponentRecovery port={port} />);
  await waitFor(() => expect(port.load).toHaveBeenCalled());
  expect(screen.queryByText('Text extraction')).toBeNull();
  expect(port.retry).not.toHaveBeenCalled();
  view.unmount();
  const unavailable: LocalComponentPort = {
    ...port,
    load: vi.fn(async () => {
      throw new Error('offline');
    }),
  };
  withQueryClient(<LocalComponentRecovery port={unavailable} />);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Refresh status' })).not.toBeNull(),
  );
  await userEvent.setup().click(screen.getByRole('button', { name: 'Refresh status' }));
  expect(unavailable.load).toHaveBeenCalledTimes(2);
  expect(unavailable.retry).not.toHaveBeenCalled();
});
