import { ArrowRight, Gift } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { focusRing } from '@/lib/focus-ring';
import { useShape } from '@/lib/shape-context';
import { cn } from '@/lib/utils';
import type { WorkspaceNotice } from '@/shared/domain/workspace-notice';

/** The strip above the workspace where something the reader did not ask about
 *  is reported. A notice they can clear carries its own dismissal, one with
 *  something to take up also carries that action, an offer is drawn as a
 *  banner, and the tone decides whether it interrupts: something to correct
 *  is an alert, everything else is a status. */
export function WorkspaceNotices({ notices }: { notices: readonly WorkspaceNotice[] }) {
  return notices.map((notice) =>
    notice.offer ? (
      <OfferBanner key={notice.message} notice={notice} />
    ) : (
      <div
        className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2"
        key={notice.message}
        role={notice.tone === 'input' ? 'alert' : 'status'}
      >
        <p
          className={cn(
            'min-w-0 flex-1 text-caption',
            notice.tone === 'input' ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          {notice.message}
        </p>
        {notice.onDismiss && (
          <Button onClick={notice.onDismiss} size="compact" variant="tertiary">
            {notice.dismissLabel}
          </Button>
        )}
        {notice.action && (
          <Button onClick={notice.action.onAct} size="compact" variant="secondary">
            {notice.action.label}
          </Button>
        )}
      </div>
    ),
  );
}

/** An offer is an announcement rather than another row of chrome: centred,
 *  its gift in the one amber mark the screen allows, its words in ink, and
 *  its answers as words too, an ink link with an arrow and a quiet way out,
 *  so no solid button outweighs the line it sits in. */
function OfferBanner({ notice }: { notice: WorkspaceNotice }) {
  const shape = useShape();
  const link = cn(
    'inline-flex shrink-0 cursor-pointer items-center gap-1 text-caption outline-none',
    shape.mark,
    focusRing(),
  );
  return (
    <div
      className="flex shrink-0 flex-wrap items-center justify-center gap-x-4 gap-y-1 border-b border-border px-4 py-2.5"
      role="status"
    >
      <p className="flex min-w-0 items-center gap-2 text-caption text-foreground">
        <Gift aria-hidden="true" className="size-4 shrink-0 text-decision" strokeWidth={1.5} />
        {notice.message}
      </p>
      {notice.action && (
        <button
          className={cn(link, 'font-medium text-foreground underline-offset-4 hover:underline')}
          onClick={notice.action.onAct}
          type="button"
        >
          {notice.action.label}
          <ArrowRight aria-hidden="true" className="size-3.5" strokeWidth={1.75} />
        </button>
      )}
      {notice.onDismiss && (
        <button
          className={cn(
            link,
            'text-muted-foreground transition-colors duration-fast hover:text-foreground',
          )}
          onClick={notice.onDismiss}
          type="button"
        >
          {notice.dismissLabel}
        </button>
      )}
    </div>
  );
}
