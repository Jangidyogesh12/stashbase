import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import type { HttpClient } from '@/platform/http/client';

import { createScheduledTasksAdapter } from './scheduled-tasks-api';

// Local wall-clock instants, so the rules read the same in every time zone.
const local = (day: number, hours: number) => new Date(2026, 9, day, hours);
const signal = () => new AbortController().signal;

const ranOn14th = {
  agent: 'claude',
  finishedAt: local(14, 8).toISOString(),
  missedCount: null,
  occurrence: local(14, 8).toISOString(),
  reason: null,
  runId: 'run-1',
  sessionId: 'native-1',
  startedAt: local(14, 8).toISOString(),
  status: 'completed',
  summary: 'Saved briefs/oct-14.md.',
  title: 'Daily brief · Oct 14',
  trigger: 'schedule',
};

const schedule = {
  folderPath: '/project/Brief',
  problem: null,
  tasks: [
    {
      agent: null,
      enabled: true,
      enabledAt: local(10, 12).toISOString(),
      files: [],
      id: 'brief',
      lastDispatchedAt: local(14, 8).toISOString(),
      lastOccurrence: local(14, 8).toISOString(),
      name: 'Daily brief',
      problem: null,
      prompt: 'Pull today’s topics.',
      runs: [ranOn14th],
      time: '08:00',
    },
  ],
  version: 'sha256:1',
};

function adapter(body: unknown = schedule) {
  const request = vi.fn(async () => ({ body, status: 200 }));
  return { api: createScheduledTasksAdapter({ request } as HttpClient), request };
}

afterEach(() => vi.useRealTimers());

describe('scheduled tasks adapter', () => {
  it('lists days missed since the last run before today’s run records them', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(local(16, 7));
    const [task] = (await adapter().api.read('/project/Brief', signal())).tasks;

    expect(task?.nextRunAt).toBe(local(16, 8).getTime());
    expect(task?.runs.map((run) => [run.status, run.missedCount, run.summary])).toEqual([
      ['missed', 1, null],
      ['completed', null, 'Saved briefs/oct-14.md.'],
    ]);
    expect(task?.runs[0]).toMatchObject({
      occurrence: local(15, 8).getTime(),
      sessionId: null,
      startedAt: local(15, 8).getTime(),
    });
  });

  it('reports a first turn’s end with the start of its last reply', async () => {
    const { api, request } = adapter({ recorded: true });
    await api.settle(
      '/project/Brief',
      'brief',
      'run-1',
      { reason: 'Rate limited.', status: 'failed', summary: 'Partial brief.' },
      signal(),
    );

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        body: {
          folderPath: '/project/Brief',
          reason: 'Rate limited.',
          runId: 'run-1',
          status: 'failed',
          summary: 'Partial brief.',
          taskId: 'brief',
        },
        method: 'PUT',
        path: '/api/scheduled-tasks/runs/settled',
      }),
    );
  });
});
