import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vite-plus/test';

import { AccountAccessError } from '@/features/settings/application/ports';
import { useAccountView } from '@/features/settings/hooks/account-context';
import { accountPort, SIGNED_IN_ACCOUNT } from '@/test/fakes/settings';
import { withQueryClient } from '@/test/query';

import { AccountMethods } from './account-methods';
import { AccountProvider } from './account-provider';
const ignoreLink = (_result: { ticket: string; url: string }) => {};
afterEach(cleanup);
function Entry() {
  const account = useAccountView();
  return account.account?.signedIn ? <AccountMethods /> : null;
}
function mount(port = accountPort(SIGNED_IN_ACCOUNT)) {
  const open = vi.fn(async () => true);
  const view = withQueryClient(
    <AccountProvider port={port} openExternal={open}>
      <Entry />
    </AccountProvider>,
  );
  return { ...view, open, port, user: userEvent.setup() };
}
it('requires mailbox proof before disconnecting Google and leaves email login available', async () => {
  const port = accountPort(SIGNED_IN_ACCOUNT, {
    methods: vi
      .fn()
      .mockResolvedValueOnce({ email: 'ada@example.com', google: true })
      .mockResolvedValue({ email: 'ada@example.com', google: false }),
  });
  const { user, open } = mount(port);
  await screen.findByText('Connected');
  await user.click(screen.getByRole('button', { name: 'Disconnect Google' }));
  await user.click(screen.getByRole('button', { name: 'Send email code' }));
  await user.type(await screen.findByRole('textbox', { name: 'Six-digit code' }), '123456');
  await user.click(screen.getByRole('button', { name: 'Verify and disconnect Google' }));
  await screen.findByText('Not connected');
  expect(screen.queryByRole('button', { name: /^Send code in/ })).toBeNull();
  expect(port.unlinkGoogle).toHaveBeenCalledWith('123456', expect.any(AbortSignal));
  expect(open).not.toHaveBeenCalled();
  expect(screen.getByRole('status').textContent).toContain('Google disconnected.');
  await user.click(screen.getByRole('button', { name: 'Connect Google' }));
  expect(screen.getByRole('button', { name: /^Send code in/ }).hasAttribute('disabled')).toBe(true);
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
  await screen.findByText('Not connected');
  await user.click(screen.getByRole('button', { name: 'Connect Google' }));
  const email = screen.getByRole('textbox', { name: 'Email' });
  expect(email).toHaveProperty('value', 'ada@example.com');
  expect(email).toHaveProperty('readOnly', true);
  expect(screen.queryByRole('textbox', { name: 'Six-digit code' })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Send email code' }));
  expect(screen.getByRole('textbox', { name: 'Email' })).toBe(email);
  expect(port.sendLinkCode).toHaveBeenCalledWith(expect.any(AbortSignal));
  expect(port.sendEmail).not.toHaveBeenCalled();
  await user.type(await screen.findByRole('textbox', { name: 'Six-digit code' }), '123456');
  await user.click(screen.getByRole('button', { name: 'Verify and connect Google' }));
  await waitFor(() => expect(open).toHaveBeenCalledWith('https://accounts.example/link'));
  await screen.findByText('Connected');
  expect(screen.getByRole('status').textContent).toBe('Google connected.');
  expect(screen.queryByRole('button', { name: /^Send code in/ })).toBeNull();
  expect(screen.queryByRole('dialog')).toBeNull();
});

it.each(['false', 'reject'])(
  'keeps the Google page to open again when the linking browser returns %s',
  async (failure) => {
    const port = accountPort(SIGNED_IN_ACCOUNT, {
      methods: vi.fn(async () => ({ email: 'ada@example.com', google: false })),
    });
    const { user, open } = mount(port);
    if (failure === 'false') open.mockResolvedValue(false);
    else open.mockRejectedValue(new Error('OS refused'));
    await screen.findByText('Not connected');
    await user.click(screen.getByRole('button', { name: 'Connect Google' }));
    await user.click(screen.getByRole('button', { name: 'Send email code' }));
    await user.type(await screen.findByRole('textbox', { name: 'Six-digit code' }), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify and connect Google' }));
    await screen.findByText('Finish signing in to StashBase in your browser.');
    await waitFor(() => expect(port.linkStatus).toHaveBeenCalled());
    open.mockResolvedValue(true);
    await user.click(screen.getByRole('button', { name: 'Open sign-in page' }));
    expect(open).toHaveBeenLastCalledWith('https://accounts.example/link');
    // The code is spent, so stopping starts over from a new one, once the
    // resend cooldown allows.
    await user.click(screen.getByRole('button', { name: 'Stop waiting' }));
    expect(await screen.findByRole('button', { name: /^Send code in \d+s$/ })).not.toBeNull();
    expect(screen.queryByText('Finish signing in to StashBase in your browser.')).toBeNull();
  },
);

it('shows available sign-in methods without requesting another email verification', async () => {
  const { port } = mount(accountPort(SIGNED_IN_ACCOUNT));
  await screen.findByRole('button', { name: 'Disconnect Google' });
  expect(screen.queryByRole('button', { name: /Send.*code/ })).toBeNull();
  expect(screen.queryByText(/Verify your email/)).toBeNull();
  expect(port.sendLinkCode).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('shows a failed method read as unavailable and recovers without sending a code', async () => {
  const port = accountPort(SIGNED_IN_ACCOUNT, {
    methods: vi
      .fn()
      .mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValue({ email: 'ada@example.com', google: true }),
  });
  const { user } = mount(port);
  await screen.findByText('Unavailable');
  expect(screen.queryByText('Not connected')).toBeNull();
  expect(screen.getByRole('button', { name: 'Connect Google' })).toHaveProperty('disabled', true);
  await user.click(screen.getByRole('button', { name: 'Retry' }));
  await screen.findByText('Connected');
  expect(port.sendLinkCode).not.toHaveBeenCalled();
});
it('cancels mailbox proof without disconnecting or clearing the resend cooldown', async () => {
  const { port, user } = mount();
  await user.click(await screen.findByRole('button', { name: 'Disconnect Google' }));
  await user.click(screen.getByRole('button', { name: 'Send email code' }));
  const code = await screen.findByRole('textbox', { name: 'Six-digit code' });
  await waitFor(() => expect(document.activeElement).toBe(code));
  await user.type(code, '123456');
  await user.click(screen.getByRole('button', { name: 'Close' }));
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(port.unlinkGoogle).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Disconnect Google' }));
  expect(screen.getByRole('button', { name: /^Send code in/ })).toHaveProperty('disabled', true);
});

it('verifies current-email sign-in in a login-style modal without Google or an inline form', async () => {
  const { port, user, open } = mount();
  await user.click(await screen.findByRole('button', { name: 'Verify email' }));
  const dialog = within(screen.getByRole('dialog', { name: 'Verify email sign-in' }));
  expect(dialog.queryByRole('button', { name: 'Continue with Google' })).toBeNull();
  expect(dialog.queryByText('or')).toBeNull();
  expect(dialog.getByRole('textbox', { name: 'Email' })).toHaveProperty('value', 'ada@example.com');
  expect(dialog.getByRole('textbox', { name: 'Email' })).toHaveProperty('readOnly', true);
  expect(dialog.queryByRole('textbox', { name: 'Six-digit code' })).toBeNull();
  await user.click(dialog.getByRole('button', { name: 'Send email code' }));
  const code = await dialog.findByRole('textbox', { name: 'Six-digit code' });
  await waitFor(() => expect(document.activeElement).toBe(code));
  expect(dialog.getByRole('button', { name: /^Resend in/ })).toHaveProperty('disabled', true);
  await user.type(code, '123456');
  await user.click(dialog.getByRole('button', { name: 'Verify email' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.getByRole('status').textContent).toContain('Email verified.');
  expect(port.sendEmailProof).toHaveBeenCalledWith(expect.any(AbortSignal));
  expect(port.sendEmail).not.toHaveBeenCalled();
  expect(port.verifyEmailProof).toHaveBeenCalledWith('123456', expect.any(AbortSignal));
  expect(port.verifyEmail).not.toHaveBeenCalled();
  expect(port.sendLinkCode).not.toHaveBeenCalled();
  expect(port.unlinkGoogle).not.toHaveBeenCalled();
  expect(open).not.toHaveBeenCalled();
});
it('closing mailbox proof leaves the login session and account methods alone', async () => {
  const { port, user } = mount();
  await user.click(await screen.findByRole('button', { name: 'Verify email' }));
  await user.click(screen.getByRole('button', { name: 'Send email code' }));
  await screen.findByRole('textbox', { name: 'Six-digit code' });
  await user.click(screen.getByRole('button', { name: 'Close' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(port.cancelEmail).not.toHaveBeenCalled();
  expect(port.verifyEmail).not.toHaveBeenCalled();
  expect(await screen.findByRole('button', { name: 'Disconnect Google' })).not.toBeNull();
});

it('closes a pending Google proof and ignores its late response', async () => {
  let release = ignoreLink;
  const pending = new Promise<{ ticket: string; url: string }>((resolve) => {
    release = resolve;
  });
  const linkGoogle = vi.fn((_otp: string, _signal: AbortSignal) => pending);
  const port = accountPort(SIGNED_IN_ACCOUNT, {
    methods: vi.fn(async () => ({ email: 'ada@example.com', google: false })),
    linkGoogle,
  });
  const { user, open } = mount(port);
  await screen.findByText('Not connected');
  await user.click(screen.getByRole('button', { name: 'Connect Google' }));
  await user.click(screen.getByRole('button', { name: 'Send email code' }));
  await user.type(await screen.findByRole('textbox', { name: 'Six-digit code' }), '123456');
  await user.click(screen.getByRole('button', { name: 'Verify and connect Google' }));
  await waitFor(() => expect(port.linkGoogle).toHaveBeenCalled());
  await user.click(screen.getByRole('button', { name: 'Close' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(linkGoogle.mock.calls[0]?.[1].aborted).toBe(true);
  await act(async () => release({ ticket: 'late', url: 'https://accounts.example/late' }));
  expect(open).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Connect Google' }));
  expect(screen.getByRole('button', { name: /^Send code in/ })).toHaveProperty('disabled', true);
  expect(screen.queryByRole('alert')).toBeNull();
});
it('clears a cancelled proof failure from Settings and the next dialog', async () => {
  const port = accountPort(SIGNED_IN_ACCOUNT, {
    unlinkGoogle: vi.fn(async () => {
      throw new AccountAccessError('invalid-request', 'Invalid code');
    }),
  });
  const { user } = mount(port);
  await user.click(await screen.findByRole('button', { name: 'Disconnect Google' }));
  await user.click(screen.getByRole('button', { name: 'Send email code' }));
  await user.type(await screen.findByRole('textbox', { name: 'Six-digit code' }), '123456');
  await user.click(screen.getByRole('button', { name: 'Verify and disconnect Google' }));
  await screen.findByRole('alert');
  await user.click(screen.getByRole('button', { name: 'Close' }));
  expect(screen.queryByRole('alert')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Disconnect Google' }));
  expect(screen.queryByRole('alert')).toBeNull();
});
it('shows the latest action result after email verification then Google disconnection', async () => {
  const { user } = mount();
  await user.click(await screen.findByRole('button', { name: 'Verify email' }));
  await user.click(screen.getByRole('button', { name: 'Send email code' }));
  await user.type(await screen.findByRole('textbox', { name: 'Six-digit code' }), '123456');
  await user.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Verify email' }),
  );
  await screen.findByText('Email verified. You can sign in with email codes.');
  await user.click(screen.getByRole('button', { name: 'Disconnect Google' }));
  expect(screen.queryByText('Email verified. You can sign in with email codes.')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Send email code' }));
  await user.type(await screen.findByRole('textbox', { name: 'Six-digit code' }), '123456');
  await user.click(screen.getByRole('button', { name: 'Verify and disconnect Google' }));
  await screen.findByText('Google disconnected. You can still sign in with email codes.');
  await user.click(screen.getByRole('button', { name: 'Verify email' }));
  expect(
    screen.queryByText('Google disconnected. You can still sign in with email codes.'),
  ).toBeNull();
});
