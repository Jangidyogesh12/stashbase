import { Button } from '@/components/ui/button';
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

/** Shared across updates started from a turn, startup, or the model menu. */
export function RuntimeSignInRecovery({
  runtimeUpdate,
}: {
  runtimeUpdate: AgentRuntimeUpdateView;
}) {
  if (!runtimeUpdate.signIn) return null;
  return (
    <section className="mx-auto w-full max-w-[46rem] px-5 pb-2 text-caption text-muted-foreground">
      <p>Sign in to finish preparing {runtimeUpdate.label}, then continue here.</p>
      <div className="mt-2 flex gap-2">
        <Button onClick={runtimeUpdate.signIn} size="compact" variant="tertiary">
          Sign in
        </Button>
        <Button
          disabled={runtimeUpdate.busy}
          onClick={() => runtimeUpdate.update()}
          size="compact"
          variant="tertiary"
        >
          Continue after sign-in
        </Button>
      </div>
    </section>
  );
}
