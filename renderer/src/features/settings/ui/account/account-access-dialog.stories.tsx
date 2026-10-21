import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import type { AccountPort } from '@/features/settings/application/ports';
import { useAccount } from '@/features/settings/hooks/use-account';

import { AccountAccessDialog } from './account-access-dialog';

const person = {
  signedIn: true,
  email: 'writer@example.com',
  displayName: null,
  avatarUrl: null,
  offers: [],
};
const anonymous = { ...person, signedIn: false, email: null };
const port: AccountPort = {
  avatar: async () => null,
  load: async () => anonymous,
  markOfferSeen: async () => anonymous,
  resetOffers: async () => anonymous,
  signInStatus: async () => ({ state: 'pending' }),
  signOut: async () => anonymous,
  startSignIn: async () => ({ flowId: 'google', url: 'https://accounts.google.com' }),
  sendEmail: async () => ({ flowId: 'email' }),
  verifyEmail: async () => person,
  cancelEmail: async () => {},
  methods: async () => ({ email: person.email, google: true }),
  sendLinkCode: async () => {},
  linkGoogle: async () => ({ ticket: 'link', url: 'https://accounts.google.com' }),
  unlinkGoogle: async () => {},
  linkStatus: async () => ({ state: 'pending' }),
};
const connected: AccountPort = { ...port, load: async () => person };
function View({ signedIn = false }: { signedIn?: boolean }) {
  const selected = signedIn ? connected : port;
  const account = useAccount(selected, () => undefined);
  return account.account ? <AccountAccessDialog account={account} port={selected} /> : null;
}
const meta = {
  title: 'Settings/Account access',
  component: View,
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
export const EmailLogin: Story = {};
export const SignInMethods: Story = { args: { signedIn: true } };
