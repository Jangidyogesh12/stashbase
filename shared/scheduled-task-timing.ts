/**
 * When a daily scheduled task runs, in local time. Electron main decides what
 * is due with these; the task list says when the next run will be with the
 * same rule, so the two can never disagree.
 *
 * A task is due once a day at its time. A run missed while the app was closed
 * or the computer slept is caught up once, but never more than one run per
 * task per local day, and never for a time before the task was switched on.
 */
export interface ScheduledTaskTiming {
  readonly enabled: boolean;
  readonly enabledAt: string | null;
  readonly lastDispatchedAt: string | null;
  readonly lastOccurrence: string | null;
  readonly problem: string | null;
  /** `HH:MM`, local. */
  readonly time: string;
}

function clock(time: string): { hours: number; minutes: number } | null {
  const match = time.match(/^(\d{2}):(\d{2})$/u);
  return match ? { hours: Number(match[1]), minutes: Number(match[2]) } : null;
}

function sameLocalDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

/** The most recent moment at or before `now` that a daily `HH:MM` task was
 *  due. A time a clock change skipped resolves the way Date normalizes it. */
export function latestOccurrence(now: Date, time: string): Date | null {
  const at = clock(time);
  if (!at) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), at.hours, at.minutes);
  if (today.getTime() <= now.getTime()) return today;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, at.hours, at.minutes);
}

/** The occurrence a task should run for now, or null when nothing is due. */
export function dueOccurrence(task: ScheduledTaskTiming, now: Date): Date | null {
  if (!task.enabled || task.problem) return null;
  const occurrence = latestOccurrence(now, task.time);
  if (!occurrence) return null;
  if (task.enabledAt && occurrence.getTime() < Date.parse(task.enabledAt)) return null;
  if (task.lastOccurrence && occurrence.getTime() <= Date.parse(task.lastOccurrence)) return null;
  if (task.lastDispatchedAt && sameLocalDay(new Date(task.lastDispatchedAt), now)) return null;
  return occurrence;
}

/** When the task will next run: `now` when it is due already, otherwise its
 *  next daily time; null while it is switched off or cannot run. */
export function nextRun(task: ScheduledTaskTiming, now: Date): Date | null {
  if (!task.enabled || task.problem) return null;
  if (dueOccurrence(task, now)) return now;
  const at = clock(task.time);
  if (!at) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), at.hours, at.minutes);
  const ranToday = task.lastDispatchedAt !== null && sameLocalDay(new Date(task.lastDispatchedAt), now);
  if (today.getTime() > now.getTime() && !ranToday) return today;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, at.hours, at.minutes);
}
