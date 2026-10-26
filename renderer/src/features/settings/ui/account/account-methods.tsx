/** Settings shows method status; mailbox proof opens in the shared login modal. */
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { useAccountPort, useAccountView } from '@/features/settings/hooks/account-context';
import { useAccountAccess } from '@/features/settings/hooks/use-account-access';
import { SettingsGroup, SettingsList, SettingsRow } from '@/features/settings/ui/rows';
import { FailureNotice } from '@/shared/ui/failure-notice';

import { AccountAccessDialog } from './account-access-dialog';
import { AccountEmailDialog } from './account-email-dialog';
import { BrowserWait } from './browser-wait';

export function AccountMethods() {
  const account = useAccountView();
  const port = useAccountPort();
  const view = useAccountAccess(port, account);
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailVerified, setEmailVerified] = useState(false);
  const connected = view.methods?.google === true;
  return (
    <SettingsGroup title="Sign-in methods">
      <SettingsList>
        <SettingsRow
          title="Email"
          detail={view.methods?.email ?? account.account?.email}
          trail={
            <div className="flex flex-wrap items-center justify-end gap-2">
              <span className="text-caption text-muted-foreground">Email codes enabled</span>
              <Button
                size="compact"
                variant="tertiary"
                onClick={() => {
                  view.clearCompleted();
                  setEmailVerified(false);
                  setEmailOpen(true);
                }}
              >
                Verify email
              </Button>
            </div>
          }
        />
        <SettingsRow
          title="Google"
          detail={
            view.loading
              ? 'Checking…'
              : !view.methods
                ? 'Unavailable'
                : connected
                  ? 'Connected'
                  : 'Not connected'
          }
          trail={
            <Button
              size="compact"
              variant="tertiary"
              disabled={view.loading || view.busy || !view.methods}
              onClick={() => {
                setEmailVerified(false);
                view.beginChange();
              }}
            >
              {connected ? 'Disconnect Google' : 'Connect Google'}
            </Button>
          }
        />
      </SettingsList>
      {(view.completed || emailVerified) && (
        <p className="text-caption" role="status">
          {emailVerified ? 'Email verified. You can sign in with email codes.' : view.completed}
        </p>
      )}
      {!view.editing && view.failure && <FailureNotice failure={view.failure} />}
      {!view.methods && !view.loading && (
        <Button variant="tertiary" onClick={view.retryMethods}>
          Retry
        </Button>
      )}
      {emailOpen && (
        <AccountAccessDialog
          account={account}
          port={port}
          emailVerification={{
            onClose: () => setEmailOpen(false),
            onVerified: () => {
              setEmailOpen(false);
              setEmailVerified(true);
            },
          }}
        />
      )}
      {view.editing && (
        <AccountEmailDialog
          title="Verify your email"
          description={
            connected
              ? 'Verify your email to disconnect Google. Email sign-in stays available.'
              : 'Verify your email, then choose a Google account to connect. Existing accounts cannot be merged.'
          }
          email={view.methods?.email ?? account.account?.email ?? ''}
          access={view}
          submitLabel={connected ? 'Verify and disconnect Google' : 'Verify and connect Google'}
          unavailable={!view.methods}
          onClose={view.cancelChange}
          waiting={
            view.waiting && (
              <BrowserWait
                url={view.signInUrl}
                onOpen={(url) => void account.openExternal(url)}
                onStop={view.stopWaiting}
              />
            )
          }
        />
      )}
    </SettingsGroup>
  );
}
