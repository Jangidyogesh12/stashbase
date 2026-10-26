import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen, userEvent } from 'storybook/test';

import { AccountPanel } from './account-panel';
import { AccountProvider } from './account-provider';
import {
  accountRuntimePort,
  signedIn as connectedAccount,
  SIGNED_OUT,
} from './account-story-fixtures';
function View({ signedIn = true, connected = true }: { signedIn?: boolean; connected?: boolean }) {
  const port = {
    ...connectedAccount,
    load: signedIn ? connectedAccount.load : async () => SIGNED_OUT,
    methods: async () => ({ email: 'ada@example.com', google: connected }),
  };
  return (
    <AccountProvider port={port} openExternal={() => undefined}>
      <AccountPanel agentRuntimeApi={accountRuntimePort()} />
    </AccountProvider>
  );
}
const meta = {
  title: 'Settings/Account',
  component: View,
  parameters: { fluidCanvas: { width: '40rem', minHeight: '20rem' } },
  decorators: [
    (Story) => (
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <Story />
      </QueryClientProvider>
    ),
  ],
} satisfies Meta<typeof View>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Connected: Story = {};
export const NotConnected: Story = { args: { connected: false } };
export const SignedOut: Story = { args: { signedIn: false } };
export const EmailProof: Story = {
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'Disconnect Google' }));
    await userEvent.click(screen.getByRole('button', { name: 'Send email code' }));
    await screen.findByRole('textbox', { name: 'Six-digit code' });
  },
};

export const ConnectEmailEntry: Story = {
  args: { connected: false },
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'Connect Google' }));
  },
};
export const ConnectEmailProof: Story = {
  args: { connected: false },
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'Connect Google' }));
    await userEvent.click(screen.getByRole('button', { name: 'Send email code' }));
    await screen.findByRole('textbox', { name: 'Six-digit code' });
  },
};

export const VerifyEmailEntry: Story = {
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'Verify email' }));
    await screen.findByRole('dialog', { name: 'Verify email sign-in' });
  },
};
export const VerifyEmailCode: Story = {
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'Verify email' }));
    await userEvent.click(screen.getByRole('button', { name: 'Send email code' }));
    await screen.findByRole('textbox', { name: 'Six-digit code' });
  },
};
