import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Sparkles } from 'lucide-react';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { CommandItem } from '@/components/ui/command-menu';
import type { SearchNavigationIntent } from '@/features/retrieval/domain/exact-search';
import type { PreparationCounts } from '@/features/retrieval/domain/semantic-readiness';
import { FeatureError } from '@/shared/domain/feature-error';
import { indexDecisionApi } from '@/test/fakes/retrieval';
import { createTestQueryClient, queryWrapper } from '@/test/query';

import type { SearchBackend, SearchLane, SearchRows } from './backend';
import { SearchSurface } from './surface';

const noPreparation: PreparationCounts = { cancelled: 0, failed: 0, pending: 0 };

function rowsOf(labels: readonly string[]): SearchRows {
  return {
    count: labels.length,
    intent: () => null,
    note: null,
    render: (view) =>
      labels.map((label, index) => (
        <CommandItem
          aria-label={label}
          id={view.rowId(index)}
          key={label}
          onClick={() => view.onOpen(index)}
        >
          {label}
        </CommandItem>
      )),
  };
}

function fakeBackend(id: string, overrides: Partial<SearchBackend> = {}): SearchBackend {
  const lane = (): SearchLane => ({
    fetch: async () => rowsOf([`${id} first`, `${id} second`]),
    key: ['test', id],
  });
  return {
    delayMs: 1,
    emptyMessage: `No ${id} results.`,
    icon: Sparkles,
    id,
    label: id,
    lane,
    placeholder: `Search ${id}`,
    resultsLabel: `${id} results`,
    surfaceLabel: `${id} search`,
    tabTitle: `Match ${id}`,
    ...overrides,
  };
}

function renderSurface(backends: readonly [SearchBackend, ...SearchBackend[]]) {
  const QueryWrapper = queryWrapper(createTestQueryClient());
  const onNavigate = vi.fn(async (_intent: SearchNavigationIntent) => true);
  return {
    onNavigate,
    ...render(
      <QueryWrapper>
        <SearchSurface
          active
          backends={backends}
          decisionApi={indexDecisionApi()}
          focusRevision={0}
          folderPath="/project/research"
          onNavigate={onNavigate}
          preparation={noPreparation}
          readiness={{ state: 'ready' }}
          readyCount={0}
        />
      </QueryWrapper>,
    ),
  };
}

const queryField = () => screen.getByRole('combobox', { name: 'Search current workspace' });

afterEach(cleanup);

describe('search surface registry', () => {
  it('gives every registered backend a tab and renders the selected one', async () => {
    renderSurface([fakeBackend('notes'), fakeBackend('tags')]);
    const user = userEvent.setup();

    expect(screen.getByRole('tab', { name: 'notes' })).not.toBeNull();
    const tagsTab = screen.getByRole('tab', { name: 'tags' });
    expect(tagsTab.getAttribute('title')).toBe('Match tags');

    await user.type(queryField(), 'answer');
    expect(await screen.findByRole('option', { name: 'notes first' })).not.toBeNull();
    expect(screen.getByRole('listbox', { name: 'notes results' })).not.toBeNull();

    await user.click(tagsTab);
    expect(await screen.findByRole('option', { name: 'tags first' })).not.toBeNull();
    expect(screen.queryByRole('option', { name: 'notes first' })).toBeNull();
    expect(queryField().getAttribute('placeholder')).toBe('Search tags');
  });

  it('reads a refused search through its failure kind and retries it', async () => {
    const fetch = vi
      .fn<() => Promise<SearchRows>>()
      .mockRejectedValueOnce(new FeatureError('ExactSearchError', 'scope-lost', 'raw detail'))
      .mockResolvedValue(rowsOf(['recovered']));
    const failing = fakeBackend('notes', {
      lane: () => ({ fetch, key: ['test', 'notes'] }),
    });
    renderSurface([failing]);
    const user = userEvent.setup();

    await user.type(queryField(), 'answer');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('That project is no longer available in this window.');
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('option', { name: 'recovered' })).not.toBeNull();
  });

  it('uses the backend copy for an empty answer', async () => {
    const empty = fakeBackend('notes', {
      lane: () => ({ fetch: async () => rowsOf([]), key: ['test', 'notes'] }),
    });
    renderSurface([empty]);

    await userEvent.setup().type(queryField(), 'answer');

    expect(await screen.findByText('No notes results.')).not.toBeNull();
  });

  it('sends nothing for a backend its readiness gate refuses', async () => {
    const fetch = vi.fn(async () => rowsOf(['unreachable']));
    const gated = fakeBackend('notes', {
      indexGate: { ready: () => false, unavailableTitle: 'Match notes · needs setup' },
      lane: () => ({ fetch, key: ['test', 'notes'] }),
    });
    renderSurface([gated]);

    await userEvent.setup().type(queryField(), 'answer');

    await waitFor(() => expect(screen.queryByText('Searching…')).toBeNull());
    expect(fetch).not.toHaveBeenCalled();
  });
});
