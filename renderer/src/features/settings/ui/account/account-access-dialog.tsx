/** Shared entry for email login and explicit Google connection management. */
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { InputField, InputGroup } from '@/components/ui/input-group';
import type { AccountPort } from '@/features/settings/application/ports';
import type { AccountViewModel } from '@/features/settings/hooks/use-account';
import { useAccountAccess } from '@/features/settings/hooks/use-account-access';
import { FailureNotice } from '@/shared/ui/failure-notice';

export function AccountAccessDialog({
  account,
  port,
}: {
  account: AccountViewModel;
  port: AccountPort;
}) {
  const view = useAccountAccess(port, account);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) account.closeAccess();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{view.managing ? 'Sign-in methods' : 'Sign in to StashBase'}</DialogTitle>
          <DialogDescription>
            {view.managing
              ? 'Manage access to this account. Your subscription stays with this account.'
              : 'Use your original email to keep your subscription and credits. New emails create a free account.'}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {view.managing ? (
            <>
              <p>Email: {view.methods?.email ?? account.account?.email}</p>
              <p>
                Email codes are enabled. Google:{' '}
                {view.loading ? 'Checking…' : view.methods?.google ? 'Connected' : 'Not connected'}
              </p>
            </>
          ) : (
            <Button variant="secondary" disabled={view.busy} onClick={account.signInWithGoogle}>
              Continue with Google
            </Button>
          )}
          {view.waiting ? (
            <p role="status">Finish connecting Google in your browser, then return here.</p>
          ) : (
            <form
              className="flex flex-col gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                if (!view.busy) {
                  if (view.sent) view.verify();
                  else view.send();
                }
              }}
            >
              <InputGroup className="w-full">
                {!view.managing && (
                  <InputField
                    label="Email"
                    resting="outline"
                    placeholder="you@example.com"
                    type="email"
                    autoComplete="email"
                    maxLength={320}
                    required
                    disabled={view.sent || view.busy}
                    value={view.email}
                    onChange={view.setEmail}
                  />
                )}
                {view.sent && (
                  <InputField
                    label="Six-digit code"
                    resting="outline"
                    placeholder="Enter the code"
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    required
                    value={view.otp}
                    onChange={view.setOtp}
                    disabled={view.busy}
                  />
                )}
              </InputGroup>
              {view.sent && (
                <p role="status">Check your inbox. The code expires in five minutes.</p>
              )}
              {view.managing && !view.sent && (
                <p>
                  {view.methods?.google
                    ? 'Verify your email to disconnect Google. You can still sign in with email codes.'
                    : 'Verify your email, then choose a Google account to connect. Existing StashBase accounts cannot be merged.'}
                </p>
              )}
              <Button
                type="submit"
                disabled={
                  view.busy ||
                  view.loading ||
                  (view.managing && !view.methods) ||
                  (!view.sent && view.remaining > 0)
                }
                loading={view.busy}
              >
                {view.sent
                  ? view.managing
                    ? view.methods?.google
                      ? 'Verify and disconnect Google'
                      : 'Verify and connect Google'
                    : 'Sign in'
                  : view.remaining > 0
                    ? `Send code in ${view.remaining}s`
                    : 'Send email code'}
              </Button>
              {view.sent && (
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    disabled={view.busy || view.remaining > 0}
                    onClick={view.send}
                  >
                    {view.remaining > 0 ? `Resend in ${view.remaining}s` : 'Resend code'}
                  </Button>
                  {!view.managing && (
                    <Button variant="ghost" disabled={view.busy} onClick={view.changeEmail}>
                      Change email
                    </Button>
                  )}
                </div>
              )}
            </form>
          )}
          {view.failure && <FailureNotice failure={view.failure} />}
          {view.managing && !view.methods && !view.loading && (
            <Button onClick={view.retryMethods}>Retry</Button>
          )}
          {view.linkFailed && (
            <p role="alert">
              Google could not be connected. It may already belong to another account. Request a new
              code to try again.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
