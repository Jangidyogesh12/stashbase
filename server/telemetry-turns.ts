import type { TelemetryEvent, AgentTurnStage, DiagnosticContext } from '../shared/protocols/http/telemetry.ts';
import type { PendingTurn, QueuedUsage, TelemetryState } from './telemetry-state.ts';

type Finished = Extract<TelemetryEvent, { event: 'agent_turn_finished' }>;
export type TurnObservation =
  | { stage: AgentTurnStage; runtime?: Finished['runtime']; context?: DiagnosticContext }
  | { outcome: Finished['outcome']; reason: NonNullable<Finished['reason']>; source?: Finished['source'] };

export function turnDuration(milliseconds: number): NonNullable<Finished['duration']> {
  return milliseconds < 10_000 ? 'under_10s' : milliseconds < 60_000 ? '10s_to_60s'
    : milliseconds < 300_000 ? '1m_to_5m' : 'over_5m';
}

/** Completing a turn consumes its reserved queue slot in the same config write
 * that removes the pending record. The turn UUID is its stable terminal UUID. */
export function finishTelemetryTurn(state: TelemetryState, turn: PendingTurn, input: Finished, at: number): void {
  const recovered = input.source === 'recovery';
  const timestamp = new Date(at).toISOString();
  const event: Finished = {
    ...input, runtime: turn.runtime, turn_id: turn.turnId,
    last_stage: turn.stage, sequence: turn.sequence + 1,
    started_at: turn.startedAt, last_observed_at: turn.observedAt,
    ...(turn.context ? { context: turn.context } : {}),
    ...(recovered ? { recovered_at: timestamp } : {
      finished_at: timestamp, duration: turnDuration(Math.max(0, at - Date.parse(turn.startedAt))),
    }),
  };
  if (recovered) delete event.duration;
  const queued: QueuedUsage = {
    installationId: turn.installationId, anonymousId: turn.anonymousId,
    firstSeenAt: turn.firstSeenAt, ...(turn.userId ? { userId: turn.userId } : {}),
    ...(turn.sessionId ? { sessionId: turn.sessionId } : {}),
    version: turn.version, distribution: turn.distribution, os: turn.os, uuid: turn.turnId, timestamp, event,
  };
  (state.queue ??= []).push(queued);
  state.turns = state.turns?.filter((item) => item.turnId !== turn.turnId);
  state.finishedTurns = Object.fromEntries([...Object.entries(state.finishedTurns ?? {}), [turn.turnId, at]].slice(-500));
}
