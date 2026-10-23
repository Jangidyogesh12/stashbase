import { Button } from '@/components/ui/button';
import type {
  PreparationReadinessLine,
  SemanticIndexNotice,
  SemanticReadinessAction,
} from '@/features/retrieval/domain/semantic-readiness';
import type { IndexDecisionAction } from '@/features/retrieval/hooks/use-index-decisions';
import { useShape } from '@/lib/shape-context';
import { cn } from '@/lib/utils';
import { FailureLine } from '@/shared/ui/failure-notice';

const ACTION_LABELS: Record<SemanticReadinessAction, string> = {
  'dismiss-warning': 'Dismiss',
  'retry-index': 'Retry',
};

/** A recovery is outlined; a dismissal is the quiet text button, said last. */
const ACTION_VARIANTS: Record<SemanticReadinessAction, 'ghost' | 'tertiary'> = {
  'dismiss-warning': 'ghost',
  'retry-index': 'tertiary',
};

/** The sentence's colour and its live region move together: a notice that
 *  needs the reader is an alert in the error colour, anything else a status
 *  in ink. */
function readinessVoice(attention: boolean) {
  return {
    role: attention ? 'alert' : 'status',
    title: attention ? 'text-destructive' : 'text-foreground',
  } as const;
}

export interface SemanticReadinessNoticeProps {
  error: string | null;
  notice: SemanticIndexNotice;
  onDecision(action: IndexDecisionAction): void;
  pendingAction: IndexDecisionAction | null;
}

/** What search by meaning needs from the reader. The notice already decided it
 *  has something to say, so this view only renders it. */
export function SemanticReadinessNotice({
  error,
  notice,
  onDecision,
  pendingAction,
}: SemanticReadinessNoticeProps) {
  const shape = useShape();
  const voice = readinessVoice(notice.tone === 'attention');
  return (
    <div
      className={cn(
        'mx-2 mb-2 border px-3 py-2',
        shape.item,
        // Paper: a prominent notice shows the page through a hairline and
        // has no fill of its own.
        notice.prominent ? 'border-border/50' : 'border-transparent',
      )}
      role={voice.role}
    >
      <p className={cn('text-caption font-medium', voice.title)}>{notice.title}</p>
      {notice.detail && (
        <p className="text-caption leading-relaxed text-muted-foreground">{notice.detail}</p>
      )}
      {error && (
        <FailureLine className="pt-1" tone="input">
          {error}
        </FailureLine>
      )}
      {notice.actions.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-1.5">
          {notice.actions.map((action) => (
            // A working button keeps its name and shows a spinner.
            <Button
              disabled={pendingAction !== null}
              key={action}
              loading={pendingAction === action}
              onClick={() => onDecision(action)}
              size="compact"
              variant={ACTION_VARIANTS[action]}
            >
              {ACTION_LABELS[action]}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

export interface PreparationReadinessNoticeProps {
  line: PreparationReadinessLine;
}

/** What preparation still owes search. Files that could not be prepared need
 *  the reader as a failed index does, so they are said the same way; work
 *  still under way is a status. */
export function PreparationReadinessNotice({ line }: PreparationReadinessNoticeProps) {
  const voice = readinessVoice(line.tone === 'attention');
  return (
    <div className="mx-2 mb-2 px-3 py-1" role={voice.role}>
      <p className={cn('text-caption font-medium', voice.title)}>{line.title}</p>
      <p className="text-caption leading-relaxed text-muted-foreground">{line.detail}</p>
    </div>
  );
}
