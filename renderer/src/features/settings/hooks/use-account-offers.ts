/**
 * The sign-in banner the window strip carries while signed out. It is shown
 * until the reader signs in or declines it, and the host remembers that across
 * launches until the next sign-out, which brings it back. The sidebar's
 * account row stays the account's only home; the banner only points at it.
 */
import { useAccountView } from '@/features/settings/hooks/account-context';
import type { WorkspaceNotice } from '@/shared/domain/workspace-notice';

export function useAccountOffers(): readonly WorkspaceNotice[] {
  const account = useAccountView();
  const person = account.account;
  if (!person || person.signedIn || !person.offers.includes('sign-in')) return [];
  if (account.signInPending) {
    return [
      {
        action: account.canStopWaiting
          ? { label: 'Stop waiting', onAct: account.stopWaiting }
          : null,
        dismissLabel: 'Not now',
        message: 'Finish signing in in your browser.',
        onDismiss: null,
        tone: 'capability',
      },
    ];
  }
  return [
    {
      action: { label: 'Sign in', onAct: account.signIn },
      dismissLabel: 'Not now',
      // What signing in gives, not a commitment to the Default Agent nor the
      // allowance's terms, which Settings → Agents shows.
      message: 'Sign in for free Agent credits every week.',
      // The offer itself is drawn as a banner; the waiting line is a row.
      offer: true,
      onDismiss: () => account.markOfferSeen('sign-in'),
      tone: 'capability',
    },
  ];
}
