/** The signed-in person as an initials disc in the account menu's header:
 *  the theme's soft accent pair — a light disc with ink letters in light
 *  mode, a dark disc with paper letters in dark — so the avatar follows the
 *  scheme without turning into a heavy ink blob beside the name. The
 *  provider's picture is never shown: one deliberate identity mark instead
 *  of a photo competing with a monochrome column. */
import { accountInitials, type HostedAccount } from '@/features/settings/domain/account';

export function AccountAvatar({
  account,
  size,
}: {
  account: HostedAccount;
  /** Edge length in pixels. */
  size: number;
}) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-accent leading-none font-medium text-accent-foreground select-none"
      style={{ fontSize: Math.max(8, Math.round(size * 0.38)), height: size, width: size }}
    >
      {accountInitials(account)}
    </span>
  );
}
