/** The preload capability for a project window's scheduled tasks: taking the
 *  runs main asks it to start, and asking main to run one now. Absent outside
 *  the desktop shell.
 *
 *  Nothing here is typed from the wire schema on purpose: preload is another
 *  process, so every value arrives as `unknown` and is parsed in the feature's
 *  infrastructure before anything reads it. */
export interface ScheduledTasksBridge {
  onRunRequested(handler: (request: unknown) => Promise<unknown>): () => void;
  runNow(request: { folderPath: string; taskId: string }): Promise<unknown>;
}

export function isScheduledTasksBridge(value: unknown): value is ScheduledTasksBridge {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.onRunRequested === 'function' && typeof candidate.runNow === 'function';
}
