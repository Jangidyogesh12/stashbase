import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vite-plus/test';

import type { JsonDocumentSession } from '@/features/documents/domain/document';
import { pressKey } from '@/test/dom';

import { JsonTree } from './tree';

afterEach(cleanup);

const BASE_SESSION: JsonDocumentSession = {
  expandedPaths: ['$'],
  search: '',
  searchOptions: { caseSensitive: false, wholeWord: false },
  selectedPath: '$',
  viewMode: 'tree',
};

/** The grid is fully controlled, so the test owns the session. */
function Harness({ initial }: { initial: string }) {
  const [session, setSession] = useState<JsonDocumentSession>(BASE_SESSION);
  return (
    <JsonTree
      onSessionChange={(patch) => setSession((current) => ({ ...current, ...patch }))}
      session={session}
      source={initial}
    />
  );
}

function rowNames(): string[] {
  return screen
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[0]?.textContent?.trim() ?? '');
}

describe('JSON tree grid', () => {
  it('explains an unusable document instead of showing an empty grid', () => {
    render(<Harness initial='{"unfinished":' />);

    expect(screen.getByRole('status').textContent).toContain('Source mode');
    expect(screen.queryByRole('treegrid')).toBeNull();
  });

  it('renders a row per visible node with its type and container summary', () => {
    render(<Harness initial='{"title":"Plan","items":[1,2]}' />);

    expect(rowNames()).toEqual(['Root', 'title', 'items']);
    const itemsRow = screen.getByRole('row', { name: /^items/u });
    expect(itemsRow.textContent).toContain('2 items');
    expect(itemsRow.getAttribute('aria-expanded')).toBe('false');
  });

  it('expands a container from its disclosure button', () => {
    render(<Harness initial='{"items":[1,2]}' />);

    fireEvent.click(screen.getByRole('button', { name: 'Expand $.items' }));
    expect(rowNames()).toEqual(['Root', 'items', '[0]', '[1]']);
    expect(screen.getByRole('button', { name: 'Collapse $.items' })).not.toBeNull();
  });

  it('walks rows with the arrow keys and selects the row it lands on', () => {
    render(<Harness initial='{"title":"Plan","items":[1,2]}' />);

    const root = screen.getByRole('row', { name: /^Root/u });
    pressKey(root, 'ArrowDown');
    expect(screen.getByRole('row', { name: /^title/u }).getAttribute('aria-selected')).toBe('true');

    pressKey(screen.getByRole('row', { name: /^title/u }), 'End');
    expect(screen.getByRole('row', { name: /^items/u }).getAttribute('aria-selected')).toBe('true');
  });

  it('reads only: no row opens an editor or offers to add or delete', () => {
    render(<Harness initial='{"title":"Plan"}' />);

    const title = screen.getByRole('row', { name: /^title/u });
    fireEvent.click(title);
    pressKey(title, 'Enter');
    pressKey(title, 'F2');
    fireEvent.doubleClick(within(title).getAllByRole('cell')[1] as HTMLElement);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: /^(Add|Delete)/u })).toBeNull();
    expect(title.getAttribute('aria-keyshortcuts')).toBeNull();
  });
});
