import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vite-plus/test';

import { useAccountView } from '@/features/settings/hooks/account-context';
import { AccountProvider } from '@/features/settings/ui/account/account-provider';
import { accountPort } from '@/test/fakes/settings';
import { withQueryClient } from '@/test/query';

afterEach(cleanup);
function Entry() {
  const account = useAccountView();
  return (
    <>
      <button onClick={account.signIn}>Open sign-in</button>
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
  const code = await screen.findByRole('textbox', { name: 'Six-digit code' });
  await waitFor(() => expect(document.activeElement).toBe(code));
  expect(screen.getByRole('dialog', { name: 'Sign in to StashBase' })).not.toBeNull();
  expect(screen.getByDisplayValue('ada@example.com')).not.toBeNull();
  expect(screen.getByRole('textbox', { name: 'Email' }).hasAttribute('readonly')).toBe(false);
  expect(screen.getByRole('button', { name: 'Continue with Google' })).not.toBeNull();
  await user.type(code, '123456');
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
  await user.type(await screen.findByRole('textbox', { name: 'Six-digit code' }), '123');
  expect(screen.queryByRole('button', { name: 'Change email' })).toBeNull();
  const email = screen.getByRole('textbox', { name: 'Email' });
  await user.clear(email);
  await user.type(email, 'correct@example.com');
  expect(port.cancelEmail).toHaveBeenCalledWith('email-flow');
  expect(email.hasAttribute('disabled')).toBe(false);
  await waitFor(() => expect(document.activeElement).toBe(email));
  expect(screen.getByDisplayValue('correct@example.com')).not.toBeNull();
  expect(screen.getByRole('button', { name: /^Send code in/ }).hasAttribute('disabled')).toBe(true);
  expect(screen.queryByRole('textbox', { name: 'Six-digit code' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Continue with Google' })).not.toBeNull();
  await user.click(screen.getByRole('button', { name: 'Close' }));
  expect(port.verifyEmail).not.toHaveBeenCalled();
});
it('opens on the email field and keeps the Google sign-in wait in the dialog', async () => {
  const { user, open } = mount();
  await user.click(screen.getByText('Open sign-in'));
  const email = await screen.findByRole('textbox', { name: 'Email' });
  await waitFor(() => expect(document.activeElement).toBe(email));
  await user.click(screen.getByRole('button', { name: 'Continue with Google' }));
  await waitFor(() => expect(open).toHaveBeenCalledWith('https://accounts.example/sign-in'));
  const dialog = within(screen.getByRole('dialog', { name: 'Sign in to StashBase' }));
  expect(dialog.getByRole('status').textContent).toBe(
    'Finish signing in to StashBase in your browser.',
  );
  expect(dialog.getByRole('button', { name: 'Open sign-in page' })).not.toBeNull();
  await user.click(dialog.getByRole('button', { name: 'Stop waiting' }));
  expect(await dialog.findByRole('textbox', { name: 'Email' })).not.toBeNull();
  expect(dialog.queryByRole('button', { name: 'Stop waiting' })).toBeNull();
});
