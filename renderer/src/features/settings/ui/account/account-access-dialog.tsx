/**
 * Shared entry for email login and explicit Google connection management.
 *
 * It follows the dialog pattern: the question in the header, the body in
 * caption text, and a footer whose one filled button submits, last, beside a
 * quiet Not now. Google is the other way in, so it is outlined rather than a
 * second filled button, and it sits below the email field, which takes the
 * first focus because it is the form the footer submits.
 *
 * A browser wait, for signing in with Google or connecting it, stays in this
 * dialog rather than handing the reader to another surface: the sentence, the
 * page again for a browser that did not open, and Stop waiting.
 */
import { useId } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { InputField, InputGroup } from '@/components/ui/input-group';
import type { AccountPort } from '@/features/settings/application/ports';
import type { AccountViewModel } from '@/features/settings/hooks/use-account';
import { useAccountAccess } from '@/features/settings/hooks/use-account-access';
import { FailureNotice } from '@/shared/ui/failure-notice';
import { SignInPageLink } from '@/shared/ui/sign-in-page-link';

/** The browser half of a sign-in: what to finish there, the page again, and
 *  the way out of waiting, last and quietest. */
function BrowserWait({
  url,
  onOpen,
  onStop,
}: {
  url: string | null;
  onOpen(url: string): void;
  onStop: (() => void) | null;
}) {
  return (
    <div className="flex flex-col items-start gap-1">
      <p className="text-foreground" role="status">
        Finish signing in to StashBase in your browser.
      </p>
      {url && <SignInPageLink url={url} onOpen={onOpen} />}
      {onStop && (
        <Button onClick={onStop} size="compact" variant="ghost">
          Stop waiting
        </Button>
      )}
    </div>
  );
}

export function AccountAccessDialog({
  account,
  port,
}: {
  account: AccountViewModel;
  port: AccountPort;
}) {
  const view = useAccountAccess(port, account);
  const formId = useId();
  // Signing in with Google waits on the account's flow; connecting it to a
  // signed-in account waits on this dialog's own.
  const signingIn = !view.managing && account.signInPending;
  const waiting = view.waiting || signingIn;
  const openPage = (url: string) => void account.openExternal(url);
  const failure = view.failure ?? (view.managing ? null : account.failure);
  const submit = view.sent
    ? view.managing
      ? view.methods?.google
        ? 'Verify and disconnect Google'
        : 'Verify and connect Google'
      : 'Sign in'
    : view.remaining > 0
      ? `Send code in ${view.remaining}s`
      : 'Send email code';
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) account.closeAccess();
      }}
    >
      {/* Managing opens on the panel: its first control is an answer, and
          there is no field to type into until a code is sent. */}
      <DialogContent initialFocus={view.managing ? 'panel' : 'first'}>
        <DialogHeader>
          <DialogTitle>{view.managing ? 'Sign-in methods' : 'Sign in to StashBase'}</DialogTitle>
          <DialogDescription>
            {view.managing
              ? 'Manage access to this account. Your subscription stays with this account.'
              : 'Use your original email to keep your subscription and credits. New emails create a free account.'}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 text-caption">
          {view.managing && (
            <div className="flex flex-col gap-1">
              <p>Email: {view.methods?.email ?? account.account?.email}</p>
              <p>
                Email codes are enabled. Google:{' '}
                {view.loading ? 'Checking…' : view.methods?.google ? 'Connected' : 'Not connected'}
              </p>
            </div>
          )}
          {!waiting && (
            <form
              className="flex flex-col gap-4"
              id={formId}
              onSubmit={(event) => {
                event.preventDefault();
                if (!view.busy) {
                  if (view.sent) view.verify();
                  else view.send();
                }
              }}
            >
              {(!view.managing || view.sent) && (
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
              )}
              {view.sent && (
                <p className="text-muted-foreground" role="status">
                  Check your inbox. The code expires in five minutes.
                </p>
              )}
              {view.managing && !view.sent && (
                <p className="text-muted-foreground">
                  {view.methods?.google
                    ? 'Verify your email to disconnect Google. You can still sign in with email codes.'
                    : 'Verify your email, then choose a Google account to connect. Existing StashBase accounts cannot be merged.'}
                </p>
              )}
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
          {!view.managing && (
            <Button
              disabled={view.busy || signingIn}
              loading={signingIn}
              onClick={account.signInWithGoogle}
              variant="tertiary"
            >
              Continue with Google
            </Button>
          )}
          {waiting && (
            <BrowserWait
              url={view.waiting ? view.signInUrl : account.signInUrl}
              onOpen={openPage}
              onStop={
                view.waiting
                  ? view.stopWaiting
                  : account.canStopWaiting
                    ? account.stopWaiting
                    : null
              }
            />
          )}
          {failure && <FailureNotice failure={failure} />}
          {view.managing && !view.methods && !view.loading && (
            <Button onClick={view.retryMethods} variant="tertiary">
              Retry
            </Button>
          )}
        </div>
        <DialogFooter>
          <Button onClick={account.closeAccess} variant="tertiary">
            Not now
          </Button>
          {!signingIn && (
            <Button
              disabled={
                view.busy ||
                view.loading ||
                (view.managing && !view.methods) ||
                (!view.sent && view.remaining > 0)
              }
              form={formId}
              loading={view.busy}
              type="submit"
            >
              {submit}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
