import type { AgentRuntimeUpdateView } from '@/features/agent/hooks/use-agent-runtime-update';
import { cn } from '@/lib/utils';

/** Under an update action: the service's latest line while it runs, then why
 *  the last update did not finish. */
export function RuntimeUpdateNotes({
  progressClassName,
  runtimeUpdate,
}: {
  /** Space above the progress line, which differs by the card it sits in. */
  progressClassName: string;
  runtimeUpdate: AgentRuntimeUpdateView;
}) {
  return (
    <>
      {runtimeUpdate.busy && runtimeUpdate.progress && (
        <p
          aria-live="polite"
          className={cn(
            'line-clamp-2 text-caption wrap-anywhere text-muted-foreground',
            progressClassName,
          )}
        >
          {runtimeUpdate.progress}
        </p>
      )}
      {runtimeUpdate.failure && (
        <p
          className="mt-1 text-caption wrap-anywhere whitespace-pre-wrap text-muted-foreground"
          role="alert"
        >
          {runtimeUpdate.failure}
        </p>
      )}
    </>
  );
}
