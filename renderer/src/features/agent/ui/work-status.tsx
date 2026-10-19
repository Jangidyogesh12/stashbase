import { useStore } from 'zustand';

import { Button } from '@/components/ui/button';
import type { AgentSessionRuntime } from '@/features/agent/application/session-runtime';
import { agentSessionIsBusy } from '@/features/agent/domain/session';

/** Recovery actions for an uncertain, failed, or paused turn stay above the composer. */
export function AgentWorkStatus({
  session,
  onOpenSettings,
}: {
  session: AgentSessionRuntime;
  onOpenSettings(): void;
}) {
  const state = useStore(session.store);
  const interruption =
    state.connection.kind === 'closed' || state.connection.kind === 'failed'
      ? state.connection.message?.trim()
      : undefined;
  const failure = state.transcript.findLast((block) => block.kind === 'error');
  const needsRepair =
    failure?.kind === 'error' &&
    failure.failure &&
    !['network', 'rate-limit', 'model-changed'].includes(failure.failure);
  const unknown = state.delivery === 'unknown';
  const repair = needsRepair && state.delivery === 'failed';
  const paused = state.queuePaused && state.queuedPrompts.length > 0;
  if (!unknown && !repair && !paused) return null;
  return (
    <div className="mx-auto flex w-full max-w-[46rem] flex-wrap items-center gap-2 px-5 pb-2 text-caption text-muted-foreground">
      {unknown && (
        <>
          <span role="status">Outcome unknown</span>
          <span>{interruption || 'The connection was interrupted.'}</span>
          <span>
            Review the conversation before sending again; file changes may already have happened.
          </span>
          <Button size="compact" variant="ghost" onClick={session.reconnect}>
            Reconnect and review
          </Button>
          {state.connection.kind === 'live' && !agentSessionIsBusy(state) && (
            <Button size="compact" variant="secondary" onClick={session.confirmOutcome}>
              I’ve reviewed it — continue
            </Button>
          )}
        </>
      )}
      {repair && (
        <Button size="compact" variant="ghost" onClick={onOpenSettings}>
          Open agent settings
        </Button>
      )}
      {paused && (
        <>
          <span>{state.queuedPrompts.length} queued · paused</span>
          <Button
            size="compact"
            variant="secondary"
            disabled={
              state.connection.kind !== 'live' ||
              agentSessionIsBusy(state) ||
              state.delivery === 'unknown'
            }
            onClick={() => void session.continueQueue()}
          >
            Continue queue
          </Button>
        </>
      )}
    </div>
  );
}
