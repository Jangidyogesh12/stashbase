/** Each Agent owns its connection controls; the Default Agent leads its group,
 *  followed by the account, credits, and plan it runs on. */
import { Button } from '@/components/ui/button';
import type { AgentRuntimePort } from '@/features/settings/application/ports';
import { accountLabel } from '@/features/settings/domain/account';
import type { AgentRuntime } from '@/features/settings/domain/agent-catalog';
import type { AgentRuntimeAction } from '@/features/settings/domain/agent-runtime-status';
import { useAccountView } from '@/features/settings/hooks/account-context';
import type { AccountViewModel } from '@/features/settings/hooks/use-account';
import { useAgentRuntimes } from '@/features/settings/hooks/use-agent-runtimes';
import { useBilling } from '@/features/settings/hooks/use-billing';
import {
  SettingsGroup,
  SettingsList,
  SettingsMessage,
  SettingsPane,
  SettingsRow,
} from '@/features/settings/ui/rows';
import { FailureNotice } from '@/shared/ui/failure-notice';

import { AllowanceRow } from './allowance-row';
import { RuntimeRow } from './runtime-row';
import { SubscriptionRows } from './subscription-rows';

export interface AgentRuntimesPanelProps {
  agentRuntimeApi: AgentRuntimePort;
}

function AccountRow({ account }: { account: AccountViewModel }) {
  const signedIn = account.account?.signedIn ?? false;
  return (
    <SettingsRow
      as="li"
      detail={
        account.account === null
          ? account.loading
            ? 'Checking…'
            : 'Account unavailable.'
          : signedIn
            ? [account.account.displayName, account.account.email]
                .filter((part): part is string => part !== null)
                .join(' · ') || accountLabel(account.account)
            : 'Sign in for free agent credits every month.'
      }
      title="Account"
      trail={
        account.loadFailed ? (
          <Button
            disabled={account.loading || account.busy}
            onClick={account.retryAccount}
            size="compact"
            variant="tertiary"
          >
            Retry account
          </Button>
        ) : signedIn ? (
          <div className="flex items-center gap-2">
            <Button
              disabled={account.busy}
              onClick={account.manageSignIn}
              size="compact"
              variant="tertiary"
            >
              Sign-in methods
            </Button>
            <Button
              disabled={account.busy}
              onClick={() => account.signOut()}
              size="compact"
              variant="ghost"
            >
              Sign out
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Button
              disabled={account.busy || account.account === null}
              loading={account.signInPending}
              onClick={() => account.signIn()}
              size="compact"
              variant="tertiary"
            >
              {account.signInPending ? 'Waiting for browser…' : 'Sign in'}
            </Button>
            {account.canStopWaiting && (
              <Button onClick={account.stopWaiting} size="compact" variant="ghost">
                Stop waiting
              </Button>
            )}
          </div>
        )
      }
    >
      {account.failure && <FailureNotice className="mt-1" failure={account.failure} />}
    </SettingsRow>
  );
}

export function AgentRuntimesPanel({ agentRuntimeApi }: AgentRuntimesPanelProps) {
  const account = useAccountView();
  const runtimes = useAgentRuntimes(agentRuntimeApi);
  const signedIn = account.account?.signedIn ?? false;
  const billing = useBilling(agentRuntimeApi, account.openExternal, signedIn);

  const onAction = (action: AgentRuntimeAction, runtime: AgentRuntime) => {
    if (action.kind === 'login') runtimes.login(runtime.id);
    else if (action.kind === 'update') runtimes.update(runtime.id);
    else runtimes.install(runtime.id);
  };

  const { allowance, catalog } = runtimes;

  return (
    <SettingsPane title="Agents">
      <SettingsGroup title="Default Agent">
        <SettingsList as="ul">
          {catalog.runtimes
            .filter((runtime) => runtime.id === 'stashbase')
            .map((runtime) => (
              <RuntimeRow
                key={runtime.id}
                runtime={runtime}
                busy={runtimes.busy(runtime.id) || account.busy}
                failure={runtimes.failure(runtime.id)}
                onAction={onAction}
              />
            ))}
          <AccountRow account={account} />
          {signedIn && (allowance.allowance || allowance.failed) && (
            <>
              {allowance.allowance ? (
                <AllowanceRow allowance={allowance.allowance} />
              ) : (
                <SettingsMessage
                  as="li"
                  message="Could not load your credit balance."
                  onRetry={runtimes.refreshAllowance}
                />
              )}
            </>
          )}
          {signedIn && <SubscriptionRows billing={billing} />}
        </SettingsList>
      </SettingsGroup>

      <SettingsGroup title="Your agents">
        <SettingsList as="ul">
          {catalog.loading && <SettingsMessage as="li" message="Checking agents…" />}
          {catalog.failed && (
            <SettingsMessage
              as="li"
              message={catalog.failure?.message ?? 'Could not load agents.'}
              onRetry={runtimes.refreshCatalog}
            />
          )}
          {catalog.runtimes
            .filter((runtime) => runtime.id !== 'stashbase')
            .map((runtime) => (
              <RuntimeRow
                busy={runtimes.busy(runtime.id)}
                failure={runtimes.failure(runtime.id)}
                key={runtime.id}
                onAction={onAction}
                runtime={runtime}
              />
            ))}
        </SettingsList>
      </SettingsGroup>
    </SettingsPane>
  );
}
