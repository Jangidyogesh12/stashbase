/** Login and current-email verification use the same modal and host email flow. */
import { Button } from '@/components/ui/button';
import type { AccountPort } from '@/features/settings/application/ports';
import type { AccountViewModel } from '@/features/settings/hooks/use-account';
import { useAccountAccess } from '@/features/settings/hooks/use-account-access';

import { AccountEmailDialog } from './account-email-dialog';
import { BrowserWait } from './browser-wait';

export function AccountAccessDialog({
  account,
  port,
  emailVerification,
}: {
  account: AccountViewModel;
  port: AccountPort;
  emailVerification?: { onClose(): void; onVerified(): void };
}) {
  const view = useAccountAccess(
    port,
    account,
    emailVerification
      ? { email: account.account?.email ?? '', onVerified: emailVerification.onVerified }
      : undefined,
  );
  const waiting = !emailVerification && account.signInPending;
  return (
    <AccountEmailDialog
      title={emailVerification ? 'Verify email sign-in' : 'Sign in to StashBase'}
      description={
        emailVerification
          ? 'Verify that you can receive sign-in codes at your account email.'
          : 'Use your original email to keep your subscription and credits. New emails create a free account.'
      }
      email={view.email}
      onEmailChange={emailVerification ? undefined : view.setEmail}
      access={{ ...view, failure: view.failure ?? account.failure }}
      submitLabel={emailVerification ? 'Verify email' : 'Sign in'}
      onClose={emailVerification?.onClose ?? account.closeAccess}
      alternative={
        !emailVerification && (
          <>
            <div className="flex items-center gap-4 text-muted-foreground">
              <span aria-hidden="true" className="h-px flex-1 bg-border" />
              <span>or</span>
              <span aria-hidden="true" className="h-px flex-1 bg-border" />
            </div>
            <Button disabled={view.busy} onClick={account.signInWithGoogle} variant="tertiary">
              Continue with Google
            </Button>
          </>
        )
      }
      waiting={
        waiting && (
          <BrowserWait
            url={account.signInUrl}
            onOpen={(url) => void account.openExternal(url)}
            onStop={account.canStopWaiting ? account.stopWaiting : null}
          />
        )
      }
    />
  );
}
