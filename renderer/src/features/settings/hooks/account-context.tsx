/**
 * One account per window.
 *
 * `useAccount` keeps the open browser flow in local state, so every caller
 * that runs it holds a different sign-in: a flow started from one surface is
 * invisible to the others, and two of them can be open at once. The surfaces
 * that offer sign-in are spread across the window — the sidebar's footer row,
 * the composer's runtime picker, Settings' Agents section — and they are all
 * talking about the same account, so the hook runs once here and they read
 * what it publishes.
 */
'use client';

import { createContext, useContext } from 'react';

import { type AccountViewModel } from '@/features/settings/hooks/use-account';

export const AccountContext = createContext<AccountViewModel | null>(null);

/** The window's account. Throws rather than falling back, because a surface
 *  that offers sign-in outside the provider would start a flow nothing else
 *  can see — the failure this context exists to prevent. */
export function useAccountView(): AccountViewModel {
  const account = useContext(AccountContext);
  if (account === null) {
    throw new Error('useAccountView requires an AccountProvider above it');
  }
  return account;
}
