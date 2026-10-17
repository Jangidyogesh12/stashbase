import { useEffect } from 'react';
import { useStore } from 'zustand';

import { Button } from '@/components/ui/button';
import type { BugReportReviewRuntime } from '@/features/bug-report/application/review-runtime';

import { ReadyView } from './ready-view';
import { ReviewForm } from './review-form';
import { StatusLine } from './status-line';

export interface BugReportReviewProps {
  runtime: BugReportReviewRuntime;
}

/** The whole review window. Loads the draft once on mount, then shows the
 *  form or the handoff for whatever state the session is in. */
export function BugReportReview({ runtime }: BugReportReviewProps) {
  const session = useStore(runtime.store);

  useEffect(() => {
    void runtime.load();
  }, [runtime]);

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-2xl flex-col gap-6 p-6 text-foreground">
      {(session.kind === 'reviewing' || session.kind === 'preparing') && (
        // Keyed by generation so a reopen mounts a fresh form, focused on the
        // problem field, the way the first load did.
        <ReviewForm key={session.generation} runtime={runtime} session={session} />
      )}
      {session.kind === 'ready' && <ReadyView runtime={runtime} session={session} />}
      {session.kind === 'unavailable' && (
        <>
          <header className="flex flex-col gap-1">
            <h1 className="text-title font-semibold">Report a Bug</h1>
            <p className="text-body text-muted-foreground">This report cannot be reviewed.</p>
          </header>
          <footer className="flex justify-end">
            <Button onClick={() => void runtime.close()} type="button" variant="secondary">
              Close
            </Button>
          </footer>
        </>
      )}
      <StatusLine session={session} />
    </main>
  );
}
