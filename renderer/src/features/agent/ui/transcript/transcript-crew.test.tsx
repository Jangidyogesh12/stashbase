import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import type { AgentTranscriptBlock } from '@/features/agent/domain/session';

import { AgentTranscript } from './transcript';

afterEach(cleanup);

const renderWith = (blocks: AgentTranscriptBlock[], activeTurn = false) =>
  render(
    <AgentTranscript
      activeTurn={activeTurn}
      blocks={blocks}
      onOpenExternal={vi.fn()}
      onPermission={vi.fn(() => true)}
      onRetry={vi.fn(() => true)}
    />,
  );
const call = (overrides: Partial<Extract<AgentTranscriptBlock, { kind: 'tool' }>>) =>
  ({
    id: 't1',
    kind: 'tool',
    name: 'stashbase_write_draft',
    crew: { id: 'writer', label: 'Writer', icon: 'pen-line', model: 'Claude Opus 5.5' },
    input: {
      task: 'Write the post.',
      context: 'For indie developers.',
      files: ['/p/notes/outline.md'],
    },
    status: 'done',
    ...overrides,
  }) as AgentTranscriptBlock;

describe('Crew transcript cards', () => {
  it('replays a cancelled call as stopped without presenting an abort message as generated prose', async () => {
    renderWith([call({ status: 'cancelled', result: 'Tool execution aborted' })]);
    await userEvent.click(
      screen.getByRole('button', { name: 'Writer on Claude Opus 5.5: Stopped' }),
    );
    expect(screen.getByText('Write the post.')).not.toBeNull();
    expect(screen.queryByText('Result')).toBeNull();
    expect(screen.queryByText('Failed')).toBeNull();
  });
  it('shows a call as its own card with the model that ran it and opens on the brief and result', async () => {
    renderWith([
      { id: 'u1', kind: 'user', text: 'Write it' },
      call({ result: '- One\n- Two\n- Three' }),
    ]);
    const card = screen.getByRole('button', { name: 'Writer on Claude Opus 5.5' });
    await userEvent.click(card);
    expect(screen.getByText('Write the post.')).not.toBeNull();
    expect(screen.getByText('outline.md')).not.toBeNull();
    expect(screen.queryByText(/From the Writer/)).toBeNull();
  });

  it('keeps a failed call visible with its reason, unlike other tool failures', () => {
    renderWith([
      { id: 'u1', kind: 'user', text: 'Write it' },
      call({
        status: 'error',
        result: 'This crew member or its model is not available right now.',
      }),
    ]);
    expect(
      screen.getByRole('button', { name: 'Writer on Claude Opus 5.5: Failed' }),
    ).not.toBeNull();
    expect(
      screen.getByText('This crew member or its model is not available right now.'),
    ).not.toBeNull();
  });

  it('names the model a running call runs on while it works', () => {
    renderWith([{ id: 'u1', kind: 'user', text: 'Write it' }, call({ status: 'running' })], true);
    expect(
      screen.getByRole('button', { name: 'Writer on Claude Opus 5.5: Working…' }),
    ).not.toBeNull();
  });
});
