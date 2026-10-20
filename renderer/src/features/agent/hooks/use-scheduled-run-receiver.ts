import { useEffect, useRef } from 'react';

import type {
  AgentCatalogPort,
  ScheduledRunsPort,
  ScheduledTasksPort,
} from '@/features/agent/application/ports';
import { startScheduledRun } from '@/features/agent/application/scheduled-run';
import type { AgentWorkspaceRuntime } from '@/features/agent/application/workspace-runtime';
import type { ScheduledTurnOutcome } from '@/features/agent/domain/scheduled-tasks';
import { useRequestSignals } from '@/shared/runtime/use-request-signals';

export interface ScheduledRunReceiverOptions {
  catalog: AgentCatalogPort;
  /** The project this window's workspace has mounted, or null before then. */
  folderPath: string | null;
  /** Absent outside the desktop shell, where nothing schedules runs. */
  runs: ScheduledRunsPort | undefined;
  runtime: AgentWorkspaceRuntime;
  /** Where a run's first-turn outcome is recorded. */
  tasks: ScheduledTasksPort | undefined;
}

/** Starts each run main hands this window, in its own project only. A run
 *  still starting when the shell unmounts is cancelled; main records it as
 *  failed. */
export function useScheduledRunReceiver({
  catalog,
  folderPath,
  runs,
  runtime,
  tasks,
}: ScheduledRunReceiverOptions) {
  const folder = useRef(folderPath);
  folder.current = folderPath;
  // One lane per task: main never runs a task twice at once, and unmounting
  // the window's shell aborts every run still starting.
  const signalFor = useRequestSignals();

  useEffect(() => {
    if (!runs) return;
    return runs.onRunRequested(async (request) => {
      // Main chose this window by the project's identity; the chat takes the
      // window's own spelling of it, so it lists and binds files here.
      const windowFolder = folder.current;
      if (!windowFolder) return { reason: 'This window has no project open.', status: 'failed' };
      try {
        const signal = signalFor(`${windowFolder}\u0000${request.taskId}`);
        const run = { ...request, folderPath: windowFolder };
        const report = tasks
          ? (outcome: ScheduledTurnOutcome) =>
              tasks.settle(
                windowFolder,
                request.taskId,
                request.runId,
                outcome,
                signalFor(`settle:${request.runId}`),
              )
          : undefined;
        return await startScheduledRun(runtime, catalog, run, signal, report);
      } catch {
        return { reason: 'The chat could not be started.', status: 'failed' };
      }
    });
  }, [catalog, runs, runtime, signalFor, tasks]);
}
