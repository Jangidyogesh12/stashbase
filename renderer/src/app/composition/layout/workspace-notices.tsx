import { ArrowRight, Gift } from 'lucide-react';

import { focusRing } from '@/lib/focus-ring';
import { useShape } from '@/lib/shape-context';
import { cn } from '@/lib/utils';
import type { DismissibleNotice, WorkspaceNotice } from '@/shared/domain/workspace-notice';
import { CornerNotice, FloatingNotice, FloatingNotices, NoticeStrip } from '@/shared/ui/notice';

const roleOf = (notice: WorkspaceNotice) => (notice.tone === 'input' ? 'alert' : 'status');

/** The strip under the title row, for standing conditions of the whole window.
 *  An offer, and the wait that follows taking it up, is drawn as a centred
 *  banner; everything else is the shared strip, its tone deciding whether it
 *  interrupts: something to correct is an alert, everything else a status. */
export function WorkspaceNotices({ notices }: { notices: readonly WorkspaceNotice[] }) {
  return notices.map((notice) =>
    notice.offer ? (
      <OfferBanner key={notice.message} notice={notice} />
    ) : (
      <NoticeStrip
        action={notice.action}
        dismissLabel={notice.dismissLabel}
        key={notice.message}
        onDismiss={notice.onDismiss}
        role={roleOf(notice)}
      >
        {notice.message}
      </NoticeStrip>
    ),
  );
}

/** Outcomes of a request the reader just made, floated over the workspace. */
export function FloatingWorkspaceNotices({ notices }: { notices: readonly DismissibleNotice[] }) {
  if (notices.length === 0) return null;
  return (
    <FloatingNotices>
      {notices.map((notice) => (
        <FloatingNotice
          actions={notice.action ? [notice.action] : []}
          dismissLabel={notice.dismissLabel}
          key={notice.message}
          onDismiss={notice.onDismiss}
          role={roleOf(notice)}
        >
          {notice.message}
        </FloatingNotice>
      ))}
    </FloatingNotices>
  );
}

/** Work the reader was not watching, as cards at the sidebar's foot. */
export function CornerWorkspaceNotices({ notices }: { notices: readonly DismissibleNotice[] }) {
  return notices.map((notice) => (
    <CornerNotice
      action={notice.action}
      dismissLabel={notice.dismissLabel}
      key={notice.message}
      onDismiss={notice.onDismiss}
      role={roleOf(notice)}
    >
      <p>{notice.message}</p>
    </CornerNotice>
  ));
}

/** An offer is an announcement rather than another row of chrome: centred,
 *  its gift in the one amber mark the screen allows, its words in ink, and
 *  its answers as words too, an ink link with an arrow and a quiet way out,
 *  so no solid button outweighs the line it sits in. The wait after taking
 *  it up stays in the same place but offers nothing, so it drops the gift. */
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
        {notice.offer === 'invitation' && (
          <Gift aria-hidden="true" className="size-4 shrink-0 text-decision" strokeWidth={1.5} />
        )}
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
