import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import type {
  NotificationPreferencesPort,
  NotificationStatus,
} from '@/shared/domain/notifications';

import { GeneralPanel } from './general-panel';
import { NotificationsGroup } from './notifications-group';

function notificationPort(
  overrides: Partial<NotificationStatus> = {},
): NotificationPreferencesPort {
  let status: NotificationStatus = {
    enabled: true,
    categories: { 'agent-confirmation': true, 'agent-completed': true, 'agent-failed': true },
    supported: true,
    delivery: 'unknown',
    ...overrides,
  };
  return {
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
      read: async () => {
        throw new Error('Unavailable preferences');
      },
    },
  },
};
export const InGeneral: Story = {
  render: ({ port }) => (
    <GeneralPanel
      notifications={port}
      softwareUpdate={{
        version: '2.16.9',
        autoCheckEnabled: true,
        busy: false,
        failure: null,
        status: 'StashBase is up to date.',
        actionLabel: 'Check for updates',
        act: () => undefined,
        setAutoCheck: () => undefined,
      }}
    />
  ),
};
