import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { NotificationsGroup } from './notifications-group';

const meta = {
  title: 'Settings/Notifications',
  component: NotificationsGroup,
  decorators: [
    (Story) => (
      <QueryClientProvider client={new QueryClient()}>
        <Story />
      </QueryClientProvider>
    ),
  ],
  args: {
    port: {
      read: async () => ({
        enabled: true,
        categories: { 'agent-confirmation': true, 'agent-completed': true, 'agent-failed': true },
        supported: true,
        delivery: 'unknown' as const,
      }),
      setEnabled: async (enabled: boolean) => ({
        enabled,
        categories: { 'agent-confirmation': true, 'agent-completed': true, 'agent-failed': true },
        supported: true,
        delivery: 'unknown' as const,
      }),
      setCategory: async (kind, enabled) => ({
        enabled: true,
        categories: {
          'agent-confirmation': true,
          'agent-completed': true,
          'agent-failed': true,
          [kind]: enabled,
        },
        supported: true,
        delivery: 'unknown' as const,
      }),
      onChanged: () => () => undefined,
    },
  },
} satisfies Meta<typeof NotificationsGroup>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const DeliveryFailed: Story = {
  args: {
    port: {
      ...meta.args.port,
      read: async () => ({
        enabled: true,
        categories: { 'agent-confirmation': true, 'agent-completed': true, 'agent-failed': true },
        supported: true,
        delivery: 'failed',
      }),
    },
  },
};
