import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import type { AgentContextItem, ContextValidation } from '@/features/agent/domain/context';
import { expectNoA11yViolations } from '@/test/axe';

import { DraftSourceTiles, isVisualSource, SentContextTiles } from './context-tiles';

afterEach(cleanup);

type SourceItem = Extract<AgentContextItem, { kind: 'source' }>;

function sourceItem(path: string, format: 'image' | 'md' | 'pdf'): SourceItem {
  return { boundVersion: null, format, kind: 'source', source: { folderPath: '/lib', path } };
}

function validation(item: AgentContextItem, overrides: Partial<ContextValidation> = {}) {
  return {
    item,
    key: `source:/lib/${item.kind === 'source' ? item.source.path : ''}`,
    reason: null,
    status: 'ready' as const,
    ...overrides,
  };
}

describe('bound context tiles', () => {
  it('gives a square tile only to a source with something to look at', () => {
    expect(isVisualSource(sourceItem('chart.png', 'image'))).toBe(true);
    expect(isVisualSource(sourceItem('paper.pdf', 'pdf'))).toBe(true);
    expect(isVisualSource(sourceItem('notes.md', 'md'))).toBe(false);
  });

  it('names each draft tile and removes the one whose badge is pressed', async () => {
    const onRemove = vi.fn();
    render(
      <DraftSourceTiles
        onRemove={onRemove}
        size={80}
        validations={[validation(sourceItem('chart.png', 'image'))]}
      />,
    );

    expect(screen.getByRole('img', { name: 'chart.png' })).not.toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Remove chart.png' }));
    expect(onRemove).toHaveBeenCalledWith(sourceItem('chart.png', 'image'));
  });

  it('states a non-ready source as a word and offers reprocessing only when it failed', async () => {
    const onReprocess = vi.fn();
    const { rerender } = render(
      <DraftSourceTiles
        onRemove={vi.fn()}
        onReprocess={onReprocess}
        size={80}
        validations={[
          validation(sourceItem('paper.pdf', 'pdf'), {
            reason: 'Searchable text is still being prepared.',
            status: 'preparing',
          }),
        ]}
      />,
    );
    expect(screen.getByText('Preparing')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Reprocess' })).toBeNull();

    rerender(
      <DraftSourceTiles
        onRemove={vi.fn()}
        onReprocess={onReprocess}
        size={80}
        validations={[
          validation(sourceItem('paper.pdf', 'pdf'), {
            reason: 'Preparation failed; the agent gets the source only.',
            status: 'failed',
          }),
        ]}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Reprocess' }));
    expect(onReprocess).toHaveBeenCalledWith({ folderPath: '/lib', path: 'paper.pdf' });
  });

  it('shows a sent turn as tiles for visual sources and chips for the rest', async () => {
    const { container } = render(
      <SentContextTiles
        items={[
          sourceItem('chart.png', 'image'),
          sourceItem('notes.md', 'md'),
          { kind: 'transient', name: 'pasted.png', path: '/tmp/pasted.png' },
        ]}
      />,
    );

    const group = screen.getByRole('group', { name: 'Sent attachments' });
    expect(within(group).getByRole('img', { name: 'chart.png' })).not.toBeNull();
    expect(within(group).getByText('notes.md')).not.toBeNull();
    expect(within(group).getByRole('img', { name: 'pasted.png' })).not.toBeNull();
    await expectNoA11yViolations(container);
  });

  it('opens a passage chip on the words, not on their Markdown marker', () => {
    render(
      <SentContextTiles
        items={[
          {
            kind: 'passage',
            quote: '1. First. No resume? Your LinkedIn profile works too.',
            source: { folderPath: '/lib', path: 'README.md' },
          },
        ]}
      />,
    );

    expect(screen.getByText(/^First\. No resume\?/u)).not.toBeNull();
    expect(screen.queryByText(/^1\. /u)).toBeNull();
  });

  it('renders nothing for a turn that carried no context', () => {
    const { container } = render(<SentContextTiles items={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
