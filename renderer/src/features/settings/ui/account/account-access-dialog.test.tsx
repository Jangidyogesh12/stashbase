import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vite-plus/test';

import { useAccountView } from '@/features/settings/hooks/account-context';
import { AccountProvider } from '@/features/settings/ui/account/account-provider';
import { accountPort, SIGNED_IN_ACCOUNT } from '@/test/fakes/settings';
import { withQueryClient } from '@/test/query';

afterEach(cleanup);
function Entry() {
  const account = useAccountView();
  return (
    <>
      <button onClick={account.signIn}>Open sign-in</button>
      <button onClick={account.manageSignIn}>Manage</button>
      <span>{account.account?.signedIn ? 'Account signed in' : 'Account signed out'}</span>
    </>
  );
}
function mount(port = accountPort()) {
  const open = vi.fn(async () => true);
  const view = withQueryClient(
    <AccountProvider port={port} openExternal={open}>
      <Entry />
    </AccountProvider>,
  );
  return { ...view, open, port, user: userEvent.setup() };
}
it('completes email login inside the application and updates account state without opening a browser', async () => {
  const { user, port, open } = mount();
  await user.click(screen.getByText('Open sign-in'));
  await user.type(await screen.findByRole('textbox', { name: 'Email' }), 'ada@example.com');
  await user.click(screen.getByRole('button', { name: 'Send email code' }));
  await user.type(await screen.findByRole('textbox', { name: 'Six-digit code' }), '123456');
  expect(screen.getByRole('button', { name: 'Resend in 60s' }).hasAttribute('disabled')).toBe(true);
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  await screen.findByText('Account signed in');
  expect(port.verifyEmail).toHaveBeenCalledWith('email-flow', '123456', expect.any(AbortSignal));
  expect(open).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).toBeNull();
});
it('cancels the host flow when the dialog closes and permits correcting the email', async () => {
  const { user, port } = mount();
  await user.click(screen.getByText('Open sign-in'));
  await user.type(await screen.findByRole('textbox', { name: 'Email' }), 'wrong@example.com');
  await user.click(screen.getByRole('button', { name: 'Send email code' }));
  await user.click(await screen.findByRole('button', { name: 'Change email' }));
  expect(port.cancelEmail).toHaveBeenCalledWith('email-flow');
  expect(screen.getByRole('textbox', { name: 'Email' }).hasAttribute('disabled')).toBe(false);
  await user.click(screen.getByRole('button', { name: 'Close' }));
  expect(port.verifyEmail).not.toHaveBeenCalled();
});
it('requires mailbox proof before disconnecting Google and leaves email login available', async () => {
  const port = accountPort(SIGNED_IN_ACCOUNT, {
    methods: vi
      .fn()
      .mockResolvedValueOnce({ email: 'ada@example.com', google: true })
      .mockResolvedValue({ email: 'ada@example.com', google: false }),
  });
  const { user, open } = mount(port);
  await user.click(screen.getByText('Manage'));
  await screen.findByText('Email codes are enabled. Google: Connected');
  await user.click(screen.getByRole('button', { name: 'Send email code' }));
  await user.type(await screen.findByRole('textbox', { name: 'Six-digit code' }), '123456');
  await user.click(screen.getByRole('button', { name: 'Verify and disconnect Google' }));
  await screen.findByText('Email codes are enabled. Google: Not connected');
  expect(port.unlinkGoogle).toHaveBeenCalledWith('123456', expect.any(AbortSignal));
  expect(open).not.toHaveBeenCalled();
});
it('opens Google only after the email proof and refreshes the connected method after completion', async () => {
  const port = accountPort(SIGNED_IN_ACCOUNT, {
    methods: vi
      .fn()
      .mockResolvedValueOnce({ email: 'ada@example.com', google: false })
      .mockResolvedValue({ email: 'ada@example.com', google: true }),
    linkStatus: vi.fn(async () => ({ state: 'complete' as const })),
  });
  const { user, open } = mount(port);
  await user.click(screen.getByText('Manage'));
  await screen.findByText('Email codes are enabled. Google: Not connected');
  await user.click(screen.getByRole('button', { name: 'Send email code' }));
  await user.type(await screen.findByRole('textbox', { name: 'Six-digit code' }), '123456');
  await user.click(screen.getByRole('button', { name: 'Verify and connect Google' }));
  await waitFor(() => expect(open).toHaveBeenCalledWith('https://accounts.example/link'));
  await screen.findByText('Email codes are enabled. Google: Connected');
});

it.each(['false', 'reject'])(
  'recovers when opening the linking browser returns %s',
  async (failure) => {
    const port = accountPort(SIGNED_IN_ACCOUNT, {
      methods: vi.fn(async () => ({ email: 'ada@example.com', google: false })),
    });
    const { user, open } = mount(port);
    if (failure === 'false') open.mockResolvedValue(false);
    else open.mockRejectedValue(new Error('OS refused'));
    await user.click(screen.getByText('Manage'));
    await screen.findByText('Email codes are enabled. Google: Not connected');
    await user.click(screen.getByRole('button', { name: 'Send email code' }));
    await user.type(await screen.findByRole('textbox', { name: 'Six-digit code' }), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify and connect Google' }));
    await screen.findByText('Could not open your browser. Request a new email code and try again.');
    expect(port.linkStatus).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Close' }).hasAttribute('disabled')).toBe(false);
  },
);
