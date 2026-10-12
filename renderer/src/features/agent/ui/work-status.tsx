import { useStore } from 'zustand';

import { Button } from '@/components/ui/button';
import type { AgentSessionRuntime } from '@/features/agent/application/session-runtime';
import { agentSessionIsBusy, agentWorkStatus } from '@/features/agent/domain/session';

/** Turn outcome and queue recovery stay visible even when the last reply is above the viewport. */
export function AgentWorkStatus({
  session,
  onOpenSettings,
}: {
  session: AgentSessionRuntime;
  onOpenSettings(): void;
}) {
  const state = useStore(session.store);
  const status = agentWorkStatus(state);
  const interruption =
    state.connection.kind === 'closed' || state.connection.kind === 'failed'
      ? state.connection.message?.trim()
      : undefined;
  const failure = state.transcript.findLast((block) => block.kind === 'error');
  const needsRepair =
    failure?.kind === 'error' &&
    failure.failure &&
    !['network', 'rate-limit', 'model-changed'].includes(failure.failure);
  if (!status && !state.queuedPrompts.length) return null;
  return (
    <div className="mx-auto flex w-full max-w-[46rem] flex-wrap items-center gap-2 px-5 pb-2 text-caption text-muted-foreground">
      <span role="status">{status}</span>
      {state.delivery === 'unknown' && (
        <>
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
      {needsRepair && state.delivery === 'failed' && (
        <Button size="compact" variant="ghost" onClick={onOpenSettings}>
          Open Agent settings
        </Button>
      )}
      {state.queuePaused && state.queuedPrompts.length > 0 && (
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
