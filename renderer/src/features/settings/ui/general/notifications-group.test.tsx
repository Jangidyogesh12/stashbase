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
  };
  let receive: (status: NotificationStatus) => void = vi.fn();
  const unsubscribe = vi.fn();
  const port: NotificationPreferencesPort = {
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
  const completion = screen.getByRole('switch', { name: 'Task completed' });
  await userEvent.click(completion);
  await waitFor(() => expect(completion.getAttribute('aria-checked')).toBe('false'));
  expect(port.setCategory).toHaveBeenCalledWith('agent-completed', false);
  expect(screen.getByRole('switch', { name: 'Task failed' }).getAttribute('aria-checked')).toBe(
    'true',
  );
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
