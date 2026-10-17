import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { CommandList } from '@/components/ui/command-menu';
import type { ExactSearchPort } from '@/features/retrieval/application/ports';
import { retrievalQueryKeys } from '@/features/retrieval/application/queries';
import type {
  ExactSearchFile,
  ExactSearchMatch,
  ExactSearchResult,
} from '@/features/retrieval/domain/exact-search';
import type { SemanticReadiness } from '@/features/retrieval/domain/semantic-readiness';
import { exactSearchApi } from '@/test/fakes/retrieval';

import { backendReady, backendTabTitle, type SearchRows } from './backend';
import { exactSearchBackend } from './exact-backend';

const FOLDER = '/Library/Research';
const READY: SemanticReadiness = { state: 'ready' };

function match(overrides: Partial<ExactSearchMatch> = {}): ExactSearchMatch {
  return { line: 12, ranges: [{ end: 9, start: 4 }], text: 'the alpha ray', ...overrides };
}

function file(overrides: Partial<ExactSearchFile> = {}): ExactSearchFile {
  return {
    id: 'file-1',
    matches: [match()],
    source: { folderPath: FOLDER, path: 'docs/plan.md' },
    totalMatches: 1,
    ...overrides,
  };
}

function result(overrides: Partial<ExactSearchResult> = {}): ExactSearchResult {
  return { files: [file()], totalMatches: 1, truncated: false, ...overrides };
}

function searchApi(answer: ExactSearchResult): ExactSearchPort {
  return exactSearchApi({ search: vi.fn(async () => answer) });
}

/** Runs the backend's own lane end to end and hands back the rows it built. */
async function fetchRows(answer: ExactSearchResult, query = 'alpha') {
  const api = searchApi(answer);
  const lane = exactSearchBackend(api).lane({ folderPath: FOLDER, query, readiness: READY });
  const rows = await lane.fetch(AbortSignal.abort());
  return { api, key: lane.key, rows };
}

/** Renders the rows the way the surface does, inside the list they need. */
function renderRows(rows: SearchRows, activeIndex = 0) {
  const onOpen = vi.fn();
  render(
    <CommandList
      activeIndex={activeIndex}
      aria-label="Keyword search results"
      onActiveIndexChange={vi.fn()}
    >
      {rows.render({ activeIndex, onOpen, rowId: (index) => `row-${index}` })}
    </CommandList>,
  );
  return onOpen;
}

afterEach(cleanup);

describe('exact search backend', () => {
  it('answers whatever search by meaning is doing, because it never consults it', () => {
    const backend = exactSearchBackend(exactSearchApi());

    expect(backend.id).toBe('exact');
    expect(backend.label).toBe('By keyword');
    expect(backend.indexGate).toBeUndefined();
    expect(backendReady(backend, { state: 'not-set-up' })).toBe(true);
    expect(backendReady(backend, { state: 'failed', warning: 'index broken' })).toBe(true);
    expect(backendTabTitle(backend, READY)).toBe('Match the exact text you type');
    expect(backend.emptyMessage).toBe('No exact matches.');
  });

  it('makes a query with a capital letter case-sensitive and keys the request by it', async () => {
    const lower = await fetchRows(result(), 'alpha');
    const upper = await fetchRows(result(), 'Alpha');

    expect(lower.api.search).toHaveBeenCalledWith(
      { caseSensitive: false, folderPath: FOLDER, query: 'alpha', wholeWord: false },
      expect.any(AbortSignal),
    );
    expect(upper.api.search).toHaveBeenCalledWith(
      expect.objectContaining({ caseSensitive: true }),
      expect.any(AbortSignal),
    );
    expect(lower.key).toEqual(
      retrievalQueryKeys.exact({
        caseSensitive: false,
        folderPath: FOLDER,
        query: 'alpha',
        wholeWord: false,
      }),
    );
    expect(lower.key).not.toEqual(upper.key);
  });

  it('says how many matches were left out only when the daemon truncated', async () => {
    const plain = await fetchRows(result());
    expect(plain.rows.note).toBeNull();

    const cut = await fetchRows(result({ totalMatches: 12_500, truncated: true }));
    expect(cut.rows.note).toBe('Showing the first results from 12,500 matches.');
  });

  it('keeps an answer about another folder away from the reader', async () => {
    const { rows } = await fetchRows(
      result({
        files: [
          file({ id: 'outside', source: { folderPath: '/Library/Other', path: 'stray.md' } }),
          file(),
        ],
      }),
    );
    renderRows(rows);

    expect(rows.count).toBe(1);
    expect(screen.queryByRole('group', { name: 'stray.md' })).toBeNull();
    expect(screen.getByRole('group', { name: 'plan.md 1' })).not.toBeNull();
  });

  it('skips a file the daemon named with no occurrence in it', async () => {
    const { rows } = await fetchRows(result({ files: [file({ matches: [] }), file({ id: 'b' })] }));

    expect(rows.count).toBe(1);
  });
});

describe('exact search rows', () => {
  it('groups occurrences under their file and names where each one sits', async () => {
    const { rows } = await fetchRows(
      result({
        files: [
          file({
            matches: [match(), match({ line: 40, text: 'another alpha line' })],
            totalMatches: 2,
          }),
        ],
      }),
    );
    renderRows(rows);

    const group = screen.getByRole('group', { name: 'plan.md 2' });
    expect(within(group).getByText('docs/')).not.toBeNull();
    expect(rows.count).toBe(2);
    expect(
      screen.getByRole('option', { name: 'plan.md, docs, Line 12, the alpha ray' }),
    ).not.toBeNull();
    expect(screen.getByRole('option', { name: /Line 40/u })).not.toBeNull();
  });

  it('falls back to a stand-in phrase for a match whose line is only whitespace', async () => {
    const { rows } = await fetchRows(
      result({
        files: [file({ matches: [match({ ranges: [{ end: 2, start: 0 }], text: '     ' })] })],
      }),
    );
    renderRows(rows);

    expect(
      screen.getByRole('option', { name: 'plan.md, docs, Line 12, Matching source' }),
    ).not.toBeNull();
  });

  it('marks the matched run inside the evidence line', async () => {
    const { rows } = await fetchRows(result());
    renderRows(rows);

    const row = screen.getByRole('option', { name: /Line 12/u });
    // A <mark> is the highlight itself; it publishes no role or label to query by.
    expect(within(row).getByText('alpha').tagName).toBe('MARK'); // dom-contract: see comment above
    expect(row.textContent).toContain('the ');
  });

  it('opens the row the reader activated and marks the active one', async () => {
    const { rows } = await fetchRows(
      result({ files: [file({ matches: [match(), match({ line: 40 })], totalMatches: 2 })] }),
    );
    const onOpen = renderRows(rows, 1);

    const second = screen.getByRole('option', { name: /Line 40/u });
    expect(second.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('option', { name: /Line 12/u }).getAttribute('aria-selected')).toBe(
      'false',
    );

    await userEvent.click(second);
    expect(onOpen).toHaveBeenCalledWith(1);
  });
});

describe('exact search navigation intents', () => {
  it('carries the source, the occurrence, and the terms the search ran with', async () => {
    const { rows } = await fetchRows(
      result({ files: [file({ matches: [match({ pdfPage: 3 })] })] }),
      'Alpha',
    );

    expect(rows.intent(0)).toEqual({
      source: { folderPath: FOLDER, path: 'docs/plan.md' },
      target: {
        caseSensitive: true,
        line: 12,
        occurrenceIndex: 0,
        pdfPage: 3,
        query: 'Alpha',
        wholeWord: false,
      },
      type: 'open-search-source',
    });
  });

  it('has nowhere to send a row that is not there', async () => {
    const { rows } = await fetchRows(result());

    expect(rows.intent(4)).toBeNull();
    expect(rows.intent(-1)).toBeNull();
  });
});
