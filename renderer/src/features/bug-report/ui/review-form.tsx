import { useEffect, useRef } from 'react';

import { Button } from '@/components/ui/button';
import type { BugReportReviewRuntime } from '@/features/bug-report/application/review-runtime';
import type {
  PreparingSession,
  ReviewingSession,
} from '@/features/bug-report/domain/review-session';

import { ArtifactRow } from './artifact-row';
import { DescriptionFields } from './description-fields';

export interface ReviewFormProps {
  runtime: BugReportReviewRuntime;
  session: ReviewingSession | PreparingSession;
}

export function ReviewForm({ runtime, session }: ReviewFormProps) {
  const problemRef = useRef<HTMLTextAreaElement | null>(null);
  const editable = session.kind === 'reviewing';
  const pending = session.kind === 'reviewing' ? session.pending : null;

  useEffect(() => {
    problemRef.current?.focus();
  }, []);

  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="text-title font-semibold">Report a bug</h1>
        <p className="text-body text-muted-foreground">
          Nothing is sent automatically. Review what to include, then share it yourself.
        </p>
      </header>
      <DescriptionFields
        description={session.draft.description}
        disabled={!editable}
        onCommit={() => void runtime.commitDescription()}
        onEdit={runtime.editDescription}
        problemRef={problemRef}
      />
      <section aria-labelledby="bug-report-attachments" className="flex flex-col gap-2">
        <h2 className="text-body font-medium" id="bug-report-attachments">
          Attachments
        </h2>
        <ul className="flex flex-col gap-2">
          {session.draft.artifacts.map((artifact) => {
            const selected =
              artifact.availability.kind === 'available' && artifact.availability.included;
            const included =
              pending?.kind === 'selection' && pending.artifactId === artifact.id
                ? pending.included
                : selected;
            return (
              <ArtifactRow
                artifact={artifact}
                editable={editable}
                included={included}
                key={artifact.id}
                onToggleInclude={(next) => void runtime.setIncluded(artifact.id, next)}
                onTogglePreview={() => void runtime.togglePreview(artifact.id)}
                open={session.openPreviewId === artifact.id}
                preview={session.previews[artifact.id]}
              />
            );
          })}
        </ul>
      </section>
      <footer className="flex justify-end gap-2">
        <Button
          disabled={!editable}
          onClick={() => void runtime.close()}
          type="button"
          variant="ghost"
        >
          Cancel
        </Button>
        <Button loading={!editable} onClick={() => void runtime.prepare()} type="button">
          Prepare report
        </Button>
      </footer>
    </>
  );
}
