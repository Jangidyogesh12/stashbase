import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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

  it('shows a file opened by a drop as the chip it was offered as, not a tile', async () => {
    const onRemove = vi.fn();
    const dropped: SourceItem = {
      boundVersion: null,
      dropped: true,
      format: 'image',
      kind: 'source',
      source: {
        folderPath: 'external:grant-token-abcdefghijklmn',
        path: '/Users/reader/header-wave.png',
      },
    };
    render(<DraftSourceTiles onRemove={onRemove} size={80} validations={[validation(dropped)]} />);

    expect(screen.queryByRole('img', { name: 'header-wave.png' })).toBeNull();
    expect(screen.getByText('header-wave.png')).not.toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Remove header-wave.png' }));
    expect(onRemove).toHaveBeenCalledWith(dropped);
  });

  it('draws each source the same way in the draft and in the sent turn', () => {
    const dropped: SourceItem = { ...sourceItem('header-wave.png', 'image'), dropped: true };
    const items = [sourceItem('chart.png', 'image'), sourceItem('notes.md', 'md'), dropped];
    const tiles = (container: HTMLElement) =>
      items.map(
        (item) => within(container).queryByRole('img', { name: item.source.path }) !== null,
      );

    const draft = render(
      <DraftSourceTiles
        onRemove={vi.fn()}
        size={80}
        validations={items.map((item) => validation(item))}
      />,
    );
    const drafted = tiles(draft.container);
    draft.unmount();
    const sent = render(<SentContextTiles items={items} />);

    expect(drafted).toEqual([true, false, false]);
    expect(tiles(sent.container)).toEqual(drafted);
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

it('locates draft and sent passages without triggering their remove action', async () => {
  const item: AgentContextItem = {
    kind: 'passage',
    quote: '**Selected words**',
    source: { folderPath: '/project', path: 'essay.md' },
  };
  const onOpenSource = vi.fn();
  const onRemove = vi.fn();
  const view = render(
    <DraftSourceTiles
      validations={[validation(item)]}
      size={80}
      onRemove={onRemove}
      onOpenSource={onOpenSource}
    />,
  );
  await userEvent.click(screen.getByRole('button', { name: /^Locate passage in essay.md/ }));
  expect(onOpenSource).toHaveBeenLastCalledWith(item.source, item.quote, 'markdown');
  expect(onRemove).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Remove essay.md' }));
  expect(onRemove).toHaveBeenCalledWith(item);
  expect(onOpenSource).toHaveBeenCalledTimes(1);
  view.rerender(<SentContextTiles items={[item]} onOpenSource={onOpenSource} />);
  await userEvent.click(screen.getByRole('button', { name: /^Locate passage in essay.md/ }));
  expect(onOpenSource).toHaveBeenCalledTimes(2);
  await expectNoA11yViolations(view.container);
});

it('keeps an expired history preview as a named file card and retries only a new URL', () => {
  const item: AgentContextItem = {
    kind: 'transient',
    name: 'expired.png',
    path: '/tmp/expired.png',
    previewUrl: '/api/agent/attachment-preview?path=expired',
  };
  const view = render(<SentContextTiles items={[item]} />);
  fireEvent.error(screen.getByRole('img', { name: item.name }));
  expect(screen.getByRole('img', { name: item.name }).tagName).toBe('DIV');
  expect(screen.getByText(item.name)).not.toBeNull();
  expect(screen.getByText('Preview unavailable')).not.toBeNull();
  view.rerender(<SentContextTiles items={[{ ...item }]} />);
  expect(screen.getByRole('img', { name: item.name }).tagName).toBe('DIV');
  view.rerender(<SentContextTiles items={[{ ...item, previewUrl: '/new-preview' }]} />);
  expect(screen.getByRole('img', { name: item.name }).getAttribute('src')).toBe('/new-preview');
});
