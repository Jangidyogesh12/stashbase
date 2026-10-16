import { describe, expect, it } from 'vite-plus/test';

import { scheduledRunPrompt, taskDraft, type ScheduledTask } from './scheduled-tasks';

const task = (prompt: string, files: string[]): ScheduledTask => ({
  agent: null,
  enabled: false,
  files,
  id: 'brief',
  name: 'Brief',
  nextRunAt: null,
  problem: null,
  prompt,
  runs: [],
  time: '08:00',
});

describe('scheduled task requests', () => {
  it('asks the Agent to follow the files when the task says nothing else', () => {
    expect(scheduledRunPrompt('', ['workflows/brief.md'])).toBe(
      'Follow the steps in @workflows/brief.md.',
    );
    expect(scheduledRunPrompt(' @a.md @b.md ', ['a.md', 'b.md'])).toBe(
      'Follow the steps in @a.md and @b.md.',
    );
    expect(scheduledRunPrompt('Use @a.md for tone.', ['a.md'])).toBe('Use @a.md for tone.');
  });

  it('shows every named file as a mention in the form', () => {
    expect(taskDraft(task('', ['workflows/brief.md'])).prompt).toBe('@workflows/brief.md');
    expect(taskDraft(task('Pull topics.', ['a.md', 'b.md'])).prompt).toBe(
      'Pull topics. @a.md @b.md',
    );
    expect(taskDraft(task('Use @a.md.', ['a.md'])).prompt).toBe('Use @a.md.');
  });
});
