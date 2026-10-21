import type { ReactNode } from 'react';

import type { AccountPort } from '@/features/settings/application/ports';
import { AccountContext } from '@/features/settings/hooks/account-context';
import { useAccount } from '@/features/settings/hooks/use-account';

import { AccountAccessDialog } from './account-access-dialog';

export function AccountProvider({
  children,
  openExternal,
  port,
}: {
  children: ReactNode;
  openExternal: (href: string) => Promise<boolean> | void;
  port: AccountPort;
}) {
  const account = useAccount(port, openExternal);
  return (
    <AccountContext value={account}>
      {children}
      {account.accessOpen && (
        <AccountAccessDialog
          key={account.account?.email ?? 'signed-out'}
          account={account}
          port={port}
        />
      )}
    </AccountContext>
  );
}
