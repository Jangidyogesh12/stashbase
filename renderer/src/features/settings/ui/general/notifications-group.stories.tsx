import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { SettingsPane } from '@/features/settings/ui/rows';
import type {
  NotificationPreferencesPort,
  NotificationStatus,
} from '@/shared/domain/notifications';

import { NotificationsGroup } from './notifications-group';

function notificationPort(
  overrides: Partial<NotificationStatus> = {},
): NotificationPreferencesPort {
  let status: NotificationStatus = {
    enabled: true,
    categories: { 'agent-confirmation': true, 'agent-completed': true, 'agent-failed': true },
    supported: true,
    delivery: 'unknown',
    systemSettings: {
      canOpen: true,
      instructions:
        'In System Settings → Notifications, select StashBase and turn on Allow notifications.',
    },
    ...overrides,
  };
  return {
    openSettings: async () => {},
    read: async () => status,
    setEnabled: async (enabled) => (status = { ...status, enabled }),
    setCategory: async (kind, enabled) =>
      (status = { ...status, categories: { ...status.categories, [kind]: enabled } }),
    onChanged: () => () => undefined,
  };
}

const meta = {
  title: 'Settings/Notifications',
  component: NotificationsGroup,
  parameters: { fluidCanvas: { width: '40rem', minHeight: '20rem' } },
  decorators: [
    (Story) => (
      <QueryClientProvider client={new QueryClient()}>
        <Story />
      </QueryClientProvider>
    ),
  ],
  args: { port: notificationPort() },
} satisfies Meta<typeof NotificationsGroup>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const Disabled: Story = { args: { port: notificationPort({ enabled: false }) } };
export const Unavailable: Story = { args: { port: notificationPort({ supported: false }) } };
export const DeliveryFailed: Story = { args: { port: notificationPort({ delivery: 'failed' }) } };
export const LoadFailed: Story = {
  args: {
    port: {
      ...notificationPort(),
      openSettings: async () => {},
      read: async () => {
        throw new Error('Unavailable preferences');
      },
    },
  },
};
export const InSettings: Story = {
  render: ({ port }) => (
    <SettingsPane title="Notifications">
      <NotificationsGroup port={port} />
    </SettingsPane>
  ),
};
export const ManualSettings: Story = {
  args: {
    port: notificationPort({
      systemSettings: {
        canOpen: false,
        instructions:
          'Open your desktop’s notification settings and allow StashBase. Check Do Not Disturb and your notification service too.',
      },
    }),
  },
};
export const SettingsLaunchFailed: Story = {
  args: {
    port: {
      ...notificationPort(),
      openSettings: async () => {
        throw new Error('Settings unavailable');
      },
    },
  },
};
