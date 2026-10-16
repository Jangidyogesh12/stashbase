import crypto from 'node:crypto';
import type { BrowserWindow, IpcMain } from 'electron';

import {
  SCHEDULED_RUN_FINISHED_CHANNEL,
  SCHEDULED_RUN_NOW_CHANNEL,
  SCHEDULED_RUN_PENDING_CHANNEL,
  SCHEDULED_RUN_REQUESTED_CHANNEL,
  SCHEDULED_TASKS_CAPABILITY,
  scheduledRunFinishedSchema,
  scheduledRunNowRequestSchema,
  scheduledRunNowResponseSchema,
  scheduledRunRequestSchema,
  type ScheduledRunNowResponse,
  type ScheduledRunOutcome,
  type ScheduledRunRequest,
} from '../../shared/protocols/electron/scheduled-tasks.ts';
import { authorizeSender, type SenderAuthorization } from '../project/dialog.ts';

export { SCHEDULED_TASKS_CAPABILITY };

interface RunWebContents {
  id: number;
  isDestroyed(): boolean;
  send(channel: string, payload: unknown): void;
}

type RunWindow = Pick<BrowserWindow, 'isDestroyed' | 'once' | 'removeListener'> & {
  webContents: RunWebContents;
};

const failed = (reason: string): ScheduledRunOutcome => ({ reason, status: 'failed' });

/** Starting a chat can mean opening the window, entering its project and
 *  starting an Agent runtime first. Longer than that, the window is stuck. */
const RUN_START_DEADLINE_MS = 3 * 60_000;

/**
 * Runs a window has been asked to start and has not answered. A run stays
 * claimable until it is answered, because a window opened for it subscribes
 * only once its workspace mounts, after the first request was sent. Several
 * runs may wait on one window at once, such as two tasks due at one time.
 */
export function createScheduledRunCoordinator({
  createRequestId = () => crypto.randomUUID(),
  timeoutMs = RUN_START_DEADLINE_MS,
}: { createRequestId?: () => string; timeoutMs?: number } = {}) {
  const waiting = new Map<number, Map<string, {
    request: ScheduledRunRequest;
    settle(outcome: ScheduledRunOutcome): void;
  }>>();

  return {
    pending(webContentsId: number): ScheduledRunRequest[] {
      return [...(waiting.get(webContentsId)?.values() ?? [])].map((entry) => entry.request);
    },

    /** Never rejects: every way a run can fail to start is an outcome. */
    request(
      window: RunWindow,
      run: Omit<ScheduledRunRequest, 'requestId'>,
      signal?: AbortSignal,
    ): Promise<ScheduledRunOutcome> {
      if (signal?.aborted) return Promise.resolve(failed('The run was cancelled.'));
      if (window.isDestroyed() || window.webContents.isDestroyed()) {
        return Promise.resolve(failed('The project window closed before the chat started.'));
      }
      const id = window.webContents.id;
      const request = scheduledRunRequestSchema.parse({ ...run, requestId: createRequestId() });
      return new Promise((resolve) => {
        const runs = waiting.get(id) ?? new Map();
        waiting.set(id, runs);
        const closed = () => settle(failed('The project window closed before the chat started.'));
        const aborted = () => settle(failed('The run was cancelled.'));
        const timer = setTimeout(
          () => settle(failed('The project window did not start the chat in time.')),
          timeoutMs,
        );
        timer.unref?.();
        function settle(outcome: ScheduledRunOutcome) {
          if (!runs.delete(request.requestId)) return;
          if (runs.size === 0 && waiting.get(id) === runs) waiting.delete(id);
          clearTimeout(timer);
          window.removeListener('closed', closed);
          signal?.removeEventListener('abort', aborted);
          resolve(outcome);
        }
        runs.set(request.requestId, { request, settle });
        window.once('closed', closed);
        signal?.addEventListener('abort', aborted, { once: true });
        try { window.webContents.send(SCHEDULED_RUN_REQUESTED_CHANNEL, request); }
        catch { settle(failed('The project window could not receive the run.')); }
      });
    },

    /** Only the window a run was sent to can answer it, and only once. */
    finish(webContentsId: number, payload: unknown): boolean {
      const parsed = scheduledRunFinishedSchema.safeParse(payload);
      if (!parsed.success) return false;
      const entry = waiting.get(webContentsId)?.get(parsed.data.requestId);
      if (!entry) return false;
      entry.settle(parsed.data.outcome);
      return true;
    },
  };
}

export interface ScheduledTasksIpcDependencies extends SenderAuthorization {
  ipcMain: Pick<IpcMain, 'handle'>;
  /** Whether this window is the one showing `folderPath`. A window may run
   *  only its own project's tasks. */
  showsFolder(window: BrowserWindow, folderPath: string): Promise<boolean>;
  runNow(window: BrowserWindow, folderPath: string, taskId: string): Promise<ScheduledRunOutcome>;
}

const refusal = (
  kind: Extract<ScheduledRunNowResponse, { ok: false }>['failure']['kind'],
  message: string,
): ScheduledRunNowResponse => ({ failure: { kind, message }, ok: false });

export function registerScheduledTasksIpc(dependencies: ScheduledTasksIpcDependencies) {
  const runs = createScheduledRunCoordinator();

  dependencies.ipcMain.handle(SCHEDULED_RUN_PENDING_CHANNEL, (event) => {
    if (!authorizeSender(event, dependencies, SCHEDULED_TASKS_CAPABILITY)) return [];
    return runs.pending(event.sender.id);
  });

  dependencies.ipcMain.handle(SCHEDULED_RUN_FINISHED_CHANNEL, (event, payload) => {
    if (!authorizeSender(event, dependencies, SCHEDULED_TASKS_CAPABILITY)) return { ok: false };
    return { ok: runs.finish(event.sender.id, payload) };
  });

  dependencies.ipcMain.handle(SCHEDULED_RUN_NOW_CHANNEL, async (event, payload) => {
    const window = authorizeSender(event, dependencies, SCHEDULED_TASKS_CAPABILITY);
    if (!window) return refusal('unauthorized', 'This window cannot run scheduled tasks.');
    const request = scheduledRunNowRequestSchema.safeParse(payload);
    if (!request.success) return refusal('invalid-request', 'That run request was invalid.');
    if (!await dependencies.showsFolder(window, request.data.folderPath)) {
      return refusal('unauthorized', 'This window shows a different project.');
    }
    try {
      const outcome = await dependencies.runNow(window, request.data.folderPath, request.data.taskId);
      return scheduledRunNowResponseSchema.parse({ ok: true, outcome });
    } catch {
      return refusal('unavailable', 'StashBase could not start this run.');
    }
  });

  return {
    /** Asks `window` to start one run's chat; answers how that went. */
    request: runs.request,
  };
}
