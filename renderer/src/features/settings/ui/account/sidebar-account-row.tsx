/**
 * The sidebar's account row, at the foot of the window's left column.
 *
 * Signed out it is one button that starts the browser sign-in; what the
 * account is worth (the bundled Agent's free credits) is stated in
 * Settings → Agents rather than inside this row. It is the same sign-in the
 * Agents section runs, through the same port, so the two entries can never
 * disagree. Signed in, the row leads with the same person glyph as every
 * other sidebar row, and its menu opens on the initials disc, then the
 * credits, Plans and billing (the plan in Settings → Agents), Settings, and
 * sign-out.
 */
import { useQuery } from '@tanstack/react-query';
import { CreditCard, Gauge, LogOut, Settings as SettingsIcon, UserRound, X } from 'lucide-react';

import {
  DropdownContent,
  DropdownLabel,
  DropdownMenu,
  DropdownSeparator,
  DropdownTrigger,
} from '@/components/ui/dropdown';
import { MenuItem } from '@/components/ui/menu-item';
import {
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar-menu';
import type { AgentRuntimePort } from '@/features/settings/application/ports';
import { agentAllowanceQuery } from '@/features/settings/application/queries';
import { accountLabel } from '@/features/settings/domain/account';
import { reservedCreditsDetail } from '@/features/settings/domain/agent-allowance';
import { useAccountView } from '@/features/settings/hooks/account-context';
import { ProgressBar } from '@/features/settings/ui/rows';
import { useSize } from '@/lib/size-context';
import { cn } from '@/lib/utils';
import { useWindowFocus } from '@/shared/runtime/use-window-focus';
import { FailureNotice } from '@/shared/ui/failure-notice';
import { clamp } from '@/shared/utils/clamp';

import { AccountAvatar } from './account-avatar';

export interface SidebarAccountRowProps {
  agentRuntimeApi: AgentRuntimePort;
  /** Opens Settings — the menu is its sidebar home, not a standing row. */
  onOpenSettings(): void;
  /** Opens the subscription, which lives with the credits in Settings → Agents. */
  onOpenPlans(): void;
}

/** The menu hangs off the account row and is read as the bottom of the left
 *  column, so its rows keep the sidebar's own geometry rather than the compact
 *  step's tighter menu spacing: the 8px inset and 8px glyph gap that
 *  sidebar-menu-button writes, around the same 14px glyph. Without it a menu
 *  row's label sat 6px left of the sidebar label directly beneath it. */
const SIDEBAR_ROW = 'gap-2 px-2';

export function SidebarAccountRow({
  agentRuntimeApi,
  onOpenPlans,
  onOpenSettings,
}: SidebarAccountRowProps) {
  const account = useAccountView();
  // The menu inherits the sidebar's compact step through the portal, so its
  // glyphs are the column's own 14px. Only the icon size comes from the step:
  // the inset and the glyph gap are the sidebar's, not the step's — see
  // SIDEBAR_ROW below.
  const sizeClasses = useSize();
  const person = account.account;
  const signedIn = person?.signedIn ?? false;
  const credits = useQuery({ ...agentAllowanceQuery(agentRuntimeApi), enabled: signedIn });

  useWindowFocus(credits.refetch, signedIn);

  if (!person || !signedIn) {
    return (
      <>
        {/* No account, no menu — Settings keeps a standing row so the
         *  complete local workspace stays reachable signed out. */}
        <SidebarMenuItem>
          <SidebarMenuButton icon={SettingsIcon} label="Settings" onClick={onOpenSettings} />
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            disabled={account.busy || account.loading || (!person && !account.loadFailed)}
            icon={UserRound}
            // The row is the action and nothing else, the length of Gallery
            // and Settings above it. It used to carry the reason inline in a
            // second tone, which made the one row in the column that reads as
            // a sentence; the offer belongs where it is acted on, so Settings
            // → Agents states it and the pointer gets it here.
            label={
              account.loadFailed
                ? 'Retry account'
                : account.signInPending
                  ? 'Waiting for browser…'
                  : 'Sign in'
            }
            onClick={account.loadFailed ? account.retryAccount : account.signIn}
            title={
              account.loadFailed
                ? 'Retry loading your account'
                : account.signInPending
                  ? undefined
                  : 'Sign in for free agent credits'
            }
          />
          {account.canStopWaiting && (
            <SidebarMenuAction
              aria-label="Stop waiting"
              onClick={account.stopWaiting}
              title="Stop waiting"
            >
              <X aria-hidden="true" />
            </SidebarMenuAction>
          )}
          {account.failure && <FailureNotice className="px-2 pb-1" failure={account.failure} />}
        </SidebarMenuItem>
      </>
    );
  }

  const label = accountLabel(person);
  const percent =
    credits.isError || credits.data === undefined
      ? null
      : clamp(Math.round(credits.data.remainingPercent), 0, 100);
  const reserved = percent !== null && credits.data ? reservedCreditsDetail(credits.data) : null;
  return (
    <SidebarMenuItem>
      <DropdownMenu
        disabled={account.busy}
        onOpenChange={(open) => {
          if (open) void credits.refetch();
        }}
      >
        <DropdownTrigger
          render={
            <SidebarMenuButton
              aria-label={`Account: ${label}`}
              label={label}
              // The same glyph as the signed-out row: the name beside it says
              // who, so the row needs no initials disc of its own, and it keeps
              // the column's glyph-and-label rhythm. The menu's header keeps
              // the disc, where it heads the account's details.
              icon={UserRound}
            />
          }
        />
        <DropdownContent align="start" className="w-72" side="top">
          <DropdownLabel className="flex items-center gap-2.5 text-foreground">
            <AccountAvatar account={person} size={32} />
            <span className="min-w-0">
              <span className="block truncate font-medium">{label}</span>
              {person.email && person.email !== label && (
                <span className="block truncate text-muted-foreground">{person.email}</span>
              )}
            </span>
          </DropdownLabel>
          <DropdownSeparator />
          <DropdownLabel>
            <span
              className={cn(
                'flex items-center justify-between gap-3 text-foreground',
                sizeClasses.text,
              )}
            >
              <span className="flex items-center gap-2 font-medium">
                <Gauge
                  aria-hidden="true"
                  className="text-muted-foreground"
                  size={sizeClasses.icon}
                  strokeWidth={1.5}
                />
                Agent credits
              </span>
              <span className="text-muted-foreground">
                {percent !== null ? `${percent}%` : credits.isError ? 'Unavailable' : '…'}
              </span>
            </span>
            {percent !== null && <ProgressBar className="mt-1.5" value={percent} />}
            {reserved && (
              <span
                className="mt-1.5 block text-muted-foreground"
                title="Reserved for active requests or fees awaiting confirmation. These credits are excluded from the available balance."
              >
                {reserved}
              </span>
            )}
          </DropdownLabel>
          <MenuItem
            className={SIDEBAR_ROW}
            icon={CreditCard}
            label="Plans and billing"
            onSelect={onOpenPlans}
          />
          <DropdownSeparator />
          <MenuItem
            className={SIDEBAR_ROW}
            icon={SettingsIcon}
            label="Sign-in methods"
            onSelect={account.manageSignIn}
          />
          <MenuItem
            className={SIDEBAR_ROW}
            icon={SettingsIcon}
            label="Settings"
            onSelect={onOpenSettings}
          />
          <MenuItem
            className={SIDEBAR_ROW}
            icon={LogOut}
            label="Sign out"
            onSelect={() => account.signOut()}
          />
        </DropdownContent>
      </DropdownMenu>
      {account.failure && <FailureNotice className="px-2 pb-1" failure={account.failure} />}
    </SidebarMenuItem>
  );
}
