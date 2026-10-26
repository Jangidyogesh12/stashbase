import { useQuery } from '@tanstack/react-query';

import type { AgentRuntimePort } from '@/features/settings/application/ports';
import { agentAllowanceQuery } from '@/features/settings/application/queries';
import { useAccountView } from '@/features/settings/hooks/account-context';
import { useBilling } from '@/features/settings/hooks/use-billing';
import { AllowanceRow } from '@/features/settings/ui/agents/allowance-row';
import { SubscriptionRows } from '@/features/settings/ui/agents/subscription-rows';
import {
  SettingsGroup,
  SettingsList,
  SettingsMessage,
  SettingsPane,
} from '@/features/settings/ui/rows';
import { useWindowFocus } from '@/shared/runtime/use-window-focus';

import { AccountMethods } from './account-methods';
import { AccountRow } from './account-row';

export function AccountPanel({ agentRuntimeApi }: { agentRuntimeApi: AgentRuntimePort }) {
  const account = useAccountView();
  const signedIn = account.account?.signedIn === true;
  const billing = useBilling(agentRuntimeApi, account.openExternal, signedIn);
  const allowance = useQuery({ ...agentAllowanceQuery(agentRuntimeApi), enabled: signedIn });
  useWindowFocus(allowance.refetch, signedIn);
  return (
    <SettingsPane title="Account">
      <SettingsGroup>
        <SettingsList as="ul">
          <AccountRow account={account} />
        </SettingsList>
      </SettingsGroup>
      {signedIn && (
        <>
          <AccountMethods key={account.account?.email} />
          <SettingsGroup title="Credits and subscription">
            <SettingsList as="ul">
              {allowance.isError ? (
                <SettingsMessage
                  as="li"
                  message="Could not load your credit balance."
                  onRetry={() => void allowance.refetch()}
                />
              ) : allowance.data ? (
                <AllowanceRow allowance={allowance.data} />
              ) : (
                <SettingsMessage as="li" message="Checking credits…" />
              )}
              <SubscriptionRows billing={billing} />
            </SettingsList>
          </SettingsGroup>
        </>
      )}
    </SettingsPane>
  );
}
