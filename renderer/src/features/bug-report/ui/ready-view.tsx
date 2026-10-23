import { useEffect, useRef } from 'react';

import { Button } from '@/components/ui/button';
import { failureMessage } from '@/features/bug-report/application/failure-messages';
import type { BugReportReviewRuntime } from '@/features/bug-report/application/review-runtime';
import type { ReadySession } from '@/features/bug-report/domain/review-session';
import { useShape } from '@/lib/shape-context';
import { cn } from '@/lib/utils';

import { UNPREPARED_TEXT } from './labels';

export interface ReadyViewProps {
  runtime: BugReportReviewRuntime;
  session: ReadySession;
}

export function ReadyView({ runtime, session }: ReadyViewProps) {
  const shape = useShape();
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const prepared = session.handoff.kind === 'prepared';
  const busy = session.pending !== null;

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="text-title font-semibold outline-none" ref={headingRef} tabIndex={-1}>
          Report ready
        </h1>
        <p className="text-body text-muted-foreground">
          {prepared
            ? 'Your selected attachments were prepared locally.'
            : 'Your report is approved; its files still need to be prepared locally.'}
        </p>
      </header>
      {session.handoff.kind !== 'prepared' && (
        <section
          className={cn(
            'flex flex-col gap-2 border border-destructive bg-surface-1 p-3',
            shape.panel,
          )}
        >
          <p className="text-body">
            {session.handoff.kind === 'failed'
              ? failureMessage(session.handoff.failure.kind)
              : UNPREPARED_TEXT}
          </p>
          <Button
            className="self-start"
            disabled={busy}
            loading={session.pending === 'retry'}
            onClick={() => void runtime.retryPrepare()}
            type="button"
            variant="tertiary"
          >
            Retry
          </Button>
        </section>
      )}
      {/* Opening GitHub is the window's one solid action, so its card comes
          last, after the plain download. */}
      <div className="grid gap-3 sm:grid-cols-2">
        <section
          className={cn('flex flex-col gap-2 border border-border bg-surface-1 p-3', shape.panel)}
        >
          <p className="text-body text-muted-foreground">
            Save the report files to your Downloads folder without opening GitHub.
          </p>
          <Button
            className="self-start"
            disabled={!prepared || busy}
            loading={session.pending === 'download'}
            onClick={() => void runtime.download()}
            type="button"
            variant="tertiary"
          >
            Download
          </Button>
        </section>
        <section
          className={cn('flex flex-col gap-2 border border-border bg-surface-1 p-3', shape.panel)}
        >
          <p className="text-body text-muted-foreground">
            The report files will be saved to your Downloads folder, and a prefilled GitHub issue
            will open. Attach the files to the issue.
          </p>
          <Button
            className="self-start"
            disabled={!prepared || busy}
            loading={session.pending === 'open-github'}
            onClick={() => void runtime.openGitHub()}
            type="button"
          >
            Open GitHub
          </Button>
        </section>
      </div>
      <footer className="flex justify-end gap-2">
        <Button
          disabled={busy}
          loading={session.pending === 'reopen'}
          onClick={() => void runtime.reopen()}
          type="button"
          variant="tertiary"
        >
          Back
        </Button>
        <Button disabled={busy} onClick={() => void runtime.close()} type="button" variant="ghost">
          Close
        </Button>
      </footer>
    </>
  );
}
