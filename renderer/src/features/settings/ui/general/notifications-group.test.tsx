import { act, cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vite-plus/test';

import type {
  NotificationPreferencesPort,
  NotificationStatus,
} from '@/shared/domain/notifications';
import { withQueryClient } from '@/test/query';

import { NotificationsGroup } from './notifications-group';

afterEach(cleanup);
it('saves opt out, receives peer window changes and preserves the confirmed value on failure', async () => {
  const saved: NotificationStatus = {
    enabled: true,
    categories: { 'agent-confirmation': true, 'agent-completed': true, 'agent-failed': true },
    supported: true,
    delivery: 'unknown',
    systemSettings: {
      canOpen: true,
      instructions:
        'In System Settings → Notifications, select StashBase and turn on Allow notifications.',
    },
  };
  let receive: (status: NotificationStatus) => void = vi.fn();
  const unsubscribe = vi.fn();
  const port: NotificationPreferencesPort = {
    openSettings: async () => {},
    read: async () => saved,
    setEnabled: vi.fn(async (enabled) => ({ ...saved, enabled })),
    setCategory: vi.fn(async (kind, enabled) => ({
      ...saved,
      categories: { ...saved.categories, [kind]: enabled },
    })),
    onChanged: (handler) => {
      receive = handler;
      return unsubscribe;
    },
  };
  const view = withQueryClient(<NotificationsGroup port={port} />);
  const toggle = await screen.findByRole('switch', {
    name: 'Enable desktop notifications',
  });
  await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'));
  const completion = screen.getByRole('switch', { name: 'Chat finished' });
  await userEvent.click(completion);
  await waitFor(() => expect(completion.getAttribute('aria-checked')).toBe('false'));
  expect(port.setCategory).toHaveBeenCalledWith('agent-completed', false);
  expect(
    screen.getByRole('switch', { name: 'Chat did not finish' }).getAttribute('aria-checked'),
  ).toBe('true');
  await userEvent.click(toggle);
  await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('false'));
  expect(port.setEnabled).toHaveBeenCalledWith(false);
  act(() => receive({ ...saved, delivery: 'failed' }));
  await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'));
  expect(screen.getByText(/last notification could not be delivered/)).toBeTruthy();
  port.setEnabled = async () => {
    throw new Error('write failed');
  };
  await userEvent.click(toggle);
  await screen.findByText('Notification preferences could not be saved.');
  expect(toggle.getAttribute('aria-checked')).toBe('true');
  view.unmount();
  expect(unsubscribe).toHaveBeenCalled();
});

it('keeps recovery available while disabled, retries launch failure and accepts refreshed system guidance', async () => {
  const saved: NotificationStatus = {
    enabled: false,
    categories: { 'agent-confirmation': true, 'agent-completed': true, 'agent-failed': true },
    supported: false,
    delivery: 'unknown',
    systemSettings: {
      canOpen: true,
      instructions: 'Select StashBase in system notification settings.',
    },
  };
  let receive: (value: NotificationStatus) => void = vi.fn();
  const openSettings = vi
    .fn()
    .mockRejectedValueOnce(new Error('Settings unavailable'))
    .mockResolvedValue(undefined);
  const setEnabled = vi.fn(async () => saved);
  const port: NotificationPreferencesPort = {
    read: async () => saved,
    openSettings,
    setEnabled,
    setCategory: async () => saved,
    onChanged: (handler) => {
      receive = handler;
      return () => {};
    },
  };
  withQueryClient(<NotificationsGroup port={port} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Open system settings' }));
  await screen.findByText(/System settings could not be opened/);
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(screen.queryByText(/System settings could not be opened/)).toBeNull());
  expect(openSettings).toHaveBeenCalledTimes(2);
  expect(setEnabled).not.toHaveBeenCalled();
  expect(screen.getByText(/Permission cannot be checked here/)).toBeTruthy();
  openSettings.mockRejectedValueOnce(new Error('Settings app removed'));
  await userEvent.click(screen.getByRole('button', { name: 'Open system settings' }));
  await screen.findByText(/System settings could not be opened/);
  act(() =>
    receive({
      ...saved,
      supported: true,
      systemSettings: {
        canOpen: false,
        instructions: 'Open your desktop notification settings manually.',
      },
    }),
  );
  await screen.findByText(/Open your desktop notification settings manually/);
  expect(screen.queryByRole('button', { name: 'Open system settings' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  expect(
    screen
      .getByRole('switch', { name: 'Enable desktop notifications' })
      .getAttribute('aria-checked'),
  ).toBe('false');
});
