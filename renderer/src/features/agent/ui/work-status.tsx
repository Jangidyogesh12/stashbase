import { useStore } from 'zustand';

import { Button } from '@/components/ui/button';
import type { AgentSessionRuntime } from '@/features/agent/application/session-runtime';
import { agentSessionIsBusy } from '@/features/agent/domain/session';

/** Recovery actions for an uncertain or failed turn stay above the composer. */
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
  if (!unknown && !repair) return null;
  return (
    <div className="mx-auto flex w-full max-w-[46rem] flex-wrap items-center gap-2 px-5 pb-2 text-caption text-muted-foreground">
      {unknown && (
        <>
          <span role="status">Outcome unknown</span>
          <span>{interruption || 'The connection was interrupted.'}</span>
          <span>Review the chat before sending again; file changes may already have happened.</span>
          <Button size="compact" variant="tertiary" onClick={session.reconnect}>
            Reconnect and review
          </Button>
          {state.connection.kind === 'live' && !agentSessionIsBusy(state) && (
            <Button size="compact" variant="tertiary" onClick={session.confirmOutcome}>
              Reviewed, continue
            </Button>
          )}
        </>
      )}
      {repair && (
        <Button size="compact" variant="tertiary" onClick={onOpenSettings}>
          Open agent settings
        </Button>
      )}
    </div>
  );
}
