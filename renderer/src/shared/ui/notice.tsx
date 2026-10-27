/**
 * How a notice is drawn when it is not a line set beside what it is about: a
 * strip, a floating card, or a corner card. Which notice goes where is the
 * Visual Style's rule; these own how each looks, so every place says it the
 * same way. The sentence is in ink, its answer follows it, and the dismissal
 * comes last and quietest. Red is kept for a line beside something
 * to correct (`FailureLine`); here the role alone says whether a notice
 * interrupts.
 */
import { X } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { useShape } from '@/lib/shape-context';
import { cn } from '@/lib/utils';

type NoticeRole = 'alert' | 'status';

export interface NoticeAction {
  readonly label: string;
  readonly onAct: () => void;
}

const NO_ACTIONS: readonly NoticeAction[] = [];

/** A condition of the window or a pane that stands until it is resolved or
 *  answered, across the top of that surface. It pushes the content down
 *  rather than covering it, and stays beside the work, so its answer is
 *  outlined rather than solid. A standing label such as read-only passes no
 *  role, since it is not news, and its own glyph and muted tone. */
export function NoticeStrip({
  action = null,
  children,
  className,
  dismissLabel = 'Dismiss',
  onDismiss = null,
  role,
}: {
  action?: (NoticeAction & { readonly busy?: boolean }) | null;
  children: ReactNode;
  /** The muted tone of a standing label; never a notice's own colour. */
  className?: string | undefined;
  dismissLabel?: string;
  onDismiss?: (() => void) | null;
  role?: NoticeRole | undefined;
}) {
  return (
    <div
      className={cn(
        'flex shrink-0 items-center gap-3 border-b border-border px-4 py-2 text-caption text-foreground',
        className,
      )}
    >
      <span className="flex min-w-0 flex-1 items-center gap-2" role={role}>
        {children}
      </span>
      {(action || onDismiss) && (
        <span className="flex shrink-0 items-center gap-2">
          {action && (
            <Button
              disabled={action.busy ?? false}
              loading={action.busy ?? false}
              onClick={action.onAct}
              size="compact"
              variant="tertiary"
            >
              {action.label}
            </Button>
          )}
          {onDismiss && (
            <Button onClick={onDismiss} size="compact" variant="ghost">
              {dismissLabel}
            </Button>
          )}
        </span>
      )}
    </div>
  );
}

/** Where the outcome of something the reader just did is said when it could
 *  not land where they acted: centred near the top of that surface, below
 *  the header row a pane keeps its own controls in, with each card above the
 *  content but the space between cards left to it. */
export function FloatingNotices({ children }: { children: ReactNode }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-12 z-40 flex flex-col items-center gap-2 px-4">
      {children}
    </div>
  );
}

/** One floating notice: the sentence, then its answers, outlined because
 *  each is a recovery such as Retry, and the dismissal last and quietest. The
 *  card is wide, so the dismissal is named rather than drawn as a cross. It
 *  is the one card with a fill, since it covers content. It is as wide as its
 *  words on one line, up to a reading measure; past that the sentence wraps
 *  and the answers stay beside it on the right. */
export function FloatingNotice({
  actions = NO_ACTIONS,
  children,
  dismissLabel = 'Dismiss',
  onDismiss,
  role,
}: {
  actions?: readonly NoticeAction[];
  children: ReactNode;
  dismissLabel?: string;
  onDismiss: () => void;
  role: NoticeRole;
}) {
  const shape = useShape();
  return (
    <div
      className={cn(
        'pointer-events-auto flex w-max max-w-[min(36rem,100%)] items-center gap-3 border border-border/50 bg-background px-4 py-2.5 text-caption text-foreground shadow-sm',
        shape.panel,
      )}
    >
      <span className="min-w-0 flex-1" role={role}>
        {children}
      </span>
      <span className="flex shrink-0 items-center gap-2">
        {actions.map((action) => (
          <Button key={action.label} onClick={action.onAct} size="compact" variant="tertiary">
            {action.label}
          </Button>
        ))}
        <Button onClick={onDismiss} size="compact" variant="ghost">
          {dismissLabel}
        </Button>
      </span>
    </div>
  );
}

/** A notice from work the reader was not watching, in the sidebar's foot.
 *  It covers nothing there, so it lies flat with no fill of its own; the
 *  column is narrow, so its dismissal is a named cross and its one answer
 *  spans the card: solid for an offer such as restarting to update, outlined
 *  for a recovery such as Retry. */
export function CornerNotice({
  action = null,
  children,
  dismissLabel,
  onDismiss,
  role,
}: {
  action?: (NoticeAction & { readonly recovery?: boolean }) | null;
  children: ReactNode;
  /** The cross's accessible name. */
  dismissLabel: string;
  onDismiss: () => void;
  role: NoticeRole;
}) {
  const shape = useShape();
  return (
    <div
      className={cn(
        'flex shrink-0 flex-col gap-2 border border-border/50 p-3 text-caption text-foreground',
        shape.panel,
      )}
      role={role}
    >
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-2">{children}</div>
        {/* One line tall, so the cross centres on the sentence's first line
            and its taller box spills evenly into the card's padding. */}
        <span className="flex h-lh shrink-0 items-center">
          <Button aria-label={dismissLabel} onClick={onDismiss} size="icon-compact" variant="ghost">
            <X aria-hidden="true" />
          </Button>
        </span>
      </div>
      {action && (
        <Button
          className="w-full"
          onClick={action.onAct}
          size="compact"
          variant={action.recovery ? 'tertiary' : 'primary'}
        >
          {action.label}
        </Button>
      )}
    </div>
  );
}
