import type { IpcRenderer } from 'electron';

import {
  SCHEDULED_RUN_FINISHED_CHANNEL,
  SCHEDULED_RUN_NOW_CHANNEL,
  SCHEDULED_RUN_PENDING_CHANNEL,
  SCHEDULED_RUN_REQUESTED_CHANNEL,
  scheduledRunNowRequestSchema,
  scheduledRunNowResponseSchema,
  scheduledRunOutcomeSchema,
  scheduledRunPendingSchema,
  scheduledRunRequestSchema,
  type ScheduledRunNowResponse,
  type ScheduledRunOutcome,
  type ScheduledRunRequest,
} from '../../shared/protocols/electron/scheduled-tasks.ts';

type ScheduledTasksIpc = Pick<IpcRenderer, 'invoke' | 'on'>;

export interface ScheduledTasksPreload {
  /** The window's one handler for the runs main sends it. Runs sent before
   *  it subscribed are taken up as it does. */
  onRunRequested(handler: (request: ScheduledRunRequest) => Promise<ScheduledRunOutcome>): () => void;
  runNow(request: { folderPath: string; taskId: string }): Promise<ScheduledRunNowResponse>;
}

const unavailable: ScheduledRunNowResponse = {
  failure: { kind: 'unavailable', message: 'StashBase could not start this run.' },
  ok: false,
};

export function createScheduledTasksPreload(ipcRenderer: ScheduledTasksIpc): ScheduledTasksPreload {
  let handler: ((request: ScheduledRunRequest) => Promise<ScheduledRunOutcome>) | null = null;
  // A run reaches the window both by push and by the pull a new subscriber
  // makes, so each one is started at most once.
  const taken = new Set<string>();

  async function receive(payload: unknown) {
    const parsed = scheduledRunRequestSchema.safeParse(payload);
    if (!parsed.success || !handler || taken.has(parsed.data.requestId)) return;
    const request = parsed.data;
    taken.add(request.requestId);
    let outcome: ScheduledRunOutcome;
    try {
      const answered = scheduledRunOutcomeSchema.safeParse(await handler(request));
      outcome = answered.success
        ? answered.data
        : { reason: 'The chat could not be started.', status: 'failed' };
    } catch {
      outcome = { reason: 'The chat could not be started.', status: 'failed' };
    }
    try {
      await ipcRenderer.invoke(SCHEDULED_RUN_FINISHED_CHANNEL, { outcome, requestId: request.requestId });
    } catch { /* Main's own deadline reports a run that never answered. */ }
  }

  ipcRenderer.on(SCHEDULED_RUN_REQUESTED_CHANNEL, (_event, payload) => { void receive(payload); });

  return Object.freeze({
    onRunRequested(next: (request: ScheduledRunRequest) => Promise<ScheduledRunOutcome>) {
      handler = next;
      void ipcRenderer.invoke(SCHEDULED_RUN_PENDING_CHANNEL).then((payload) => {
        const parsed = scheduledRunPendingSchema.safeParse(payload);
        if (parsed.success) for (const request of parsed.data) void receive(request);
      }).catch(() => {});
      return () => { if (handler === next) handler = null; };
    },
    async runNow(request: { folderPath: string; taskId: string }) {
      const parsedRequest = scheduledRunNowRequestSchema.safeParse(request);
      if (!parsedRequest.success) return unavailable;
      try {
        const response = scheduledRunNowResponseSchema.safeParse(
          await ipcRenderer.invoke(SCHEDULED_RUN_NOW_CHANNEL, parsedRequest.data),
        );
        return response.success ? response.data : unavailable;
      } catch {
        return unavailable;
      }
    },
  });
}
