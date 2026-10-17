import {
  agentTurnIsActive,
  scopeLabel,
  type AgentSessionState,
} from '@/features/agent/domain/session';

import { observeAgentSessions } from './observe-sessions';
import type { AgentWorkspaceRuntime } from './workspace-runtime';

interface TurnOutcome {
  id: string;
  kind: 'agent-completed' | 'agent-failed';
  sessionId: string;
  blockId: string | null;
  project: string;
  conversation: string;
}

/** Only observed submission or live-turn transitions can announce an outcome.
 * Restoring history and repeated terminal events never start a new turn. */
export function observeAgentOutcomes(
  runtime: AgentWorkspaceRuntime,
  publish: (outcomes: TurnOutcome[]) => void,
) {
  const running = new Map<string, { cancelled: boolean; live: boolean; settling: boolean }>();
  const outcomes = new Map<string, TurnOutcome>();
  let sequence = 0;
  const emit = () => publish([...outcomes.values()]);
  const record = (id: string, state: AgentSessionState, live: boolean) => {
    const block = live
      ? state.transcript.findLast(
          (entry) => entry.kind === 'assistant' || entry.kind === 'error' || entry.kind === 'user',
        )
      : null;
    outcomes.set(id, {
      id: JSON.stringify([id, ++sequence]),
      kind: state.delivery === 'completed' ? 'agent-completed' : 'agent-failed',
      sessionId: id,
      blockId: block?.id ?? null,
      project: scopeLabel(state.scope).slice(0, 160),
      conversation: state.title.slice(0, 160),
    });
    emit();
  };
  const stop = observeAgentSessions(
    runtime,
    (session, state, previous) => {
      const id = session.id;
      if (state.connection.kind === 'retired' || state.connection.kind === 'disposed') {
        running.delete(id);
        if (outcomes.delete(id)) emit();
        return;
      }
      let turn = running.get(id);
      if (
        !turn &&
        ((agentTurnIsActive(state.connection) &&
          (!previous || !agentTurnIsActive(previous.connection))) ||
          (state.delivery === 'preparing' && previous?.delivery !== 'preparing'))
      ) {
        turn = { cancelled: false, live: false, settling: false };
        running.set(id, turn);
        if (outcomes.get(id)?.blockId === null) {
          outcomes.delete(id);
          emit();
        }
      }
      if (!turn) return;
      if (state.delivery === 'stopping' || state.delivery === 'stopped') turn.cancelled = true;
      if (agentTurnIsActive(state.connection)) {
        turn.live = true;
        return;
      }
      if (turn.cancelled) {
        running.delete(id);
        return;
      }
      if (!['completed', 'failed', 'unknown'].includes(state.delivery) || turn.settling) return;
      if (turn.live) {
        running.delete(id);
        record(id, state, true);
      } else {
        // A stop during startup closes the transport before setting `stopped`.
        // Settle after that synchronous sequence; a close alone is not failure.
        const pending = turn;
        pending.settling = true;
        queueMicrotask(() => {
          if (running.get(id) !== pending) return;
          running.delete(id);
          if (!pending.cancelled) record(id, state, false);
        });
      }
    },
    (id) => {
      running.delete(id);
      if (outcomes.delete(id)) emit();
    },
  );
  emit();
  return {
    dispose() {
      stop();
      running.clear();
      outcomes.clear();
    },
    activate(kind: TurnOutcome['kind'], id: string) {
      const outcome = [...outcomes.values()].find(
        (entry) => entry.id === id && entry.kind === kind,
      );
      if (!outcome || runtime.store.getState().disposed) return false;
      const state = runtime.session(outcome.sessionId)?.store.getState();
      if (
        !state ||
        (outcome.blockId
          ? !state.transcript.some((block) => block.id === outcome.blockId)
          : !['failed', 'unknown'].includes(state.delivery))
      )
        return false;
      runtime.activate(outcome.sessionId);
      runtime.store.setState({
        attentionTarget: outcome.blockId
          ? { sessionId: outcome.sessionId, blockId: outcome.blockId }
          : null,
      });
      outcomes.delete(outcome.sessionId);
      emit();
      return true;
    },
  };
}
