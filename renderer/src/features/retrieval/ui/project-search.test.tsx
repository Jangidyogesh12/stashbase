import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import type {
  ExactSearchPort,
  IndexDecisionPort,
  SemanticSearchPort,
} from '@/features/retrieval/application/ports';
import type {
  ExactSearchFile,
  SearchNavigationIntent,
  ExactSearchResult,
} from '@/features/retrieval/domain/exact-search';
import type {
  PreparationCounts,
  SemanticReadiness,
} from '@/features/retrieval/domain/semantic-readiness';
import type { SemanticSearchResult } from '@/features/retrieval/domain/semantic-search';
import { expectFocused, expectNotFocused } from '@/test/dom';
import { exactSearchApi, indexDecisionApi, semanticSearchApi } from '@/test/fakes/retrieval';
import { createTestQueryClient, queryWrapper } from '@/test/query';

import { ProjectSearch, type ProjectSearchProps } from './project-search';

const noPreparation: PreparationCounts = { cancelled: 0, failed: 0, pending: 0 };

const READY_INDEX: SemanticReadiness = { state: 'ready' };

const semanticResult: SemanticSearchResult = {
  hits: [
    {
      chunkIndex: 1,
      content: 'Meaningful chunk about answers.\nMore text.',
      heading: 'Answers',
      id: '/project/research\u0000notes/idea.md\u00001',
      score: 0.9,
      snippet: 'Meaningful chunk about answers. More text.',
      source: { folderPath: '/project/research', path: 'notes/idea.md' },
      startLine: 12,
    },
    {
      chunkIndex: 0,
      content: 'Another folder chunk.',
      heading: '',
      id: '/project/archive\u0000old.md\u00000',
      score: 0.5,
      snippet: 'Another folder chunk.',
      source: { folderPath: '/project/archive', path: 'old.md' },
      startLine: 2,
    },
  ],
  truncated: false,
};

const resultFile: ExactSearchFile = {
  id: '/project/archive\u0000notes/answer.md',
  matches: [
    {
      line: 7,
      ranges: [{ end: 10, start: 4 }],
      text: 'The answer is preserved here.',
    },
  ],
  source: { folderPath: '/project/research', path: 'notes/answer.md' },
  totalMatches: 2,
};

const result: ExactSearchResult = {
  files: [resultFile],
  totalMatches: 2,
  truncated: true,
};

afterEach(cleanup);

interface RenderOptions {
  indexWarning?: string;
  onConfigureSearch?: () => void;
  decisions?: IndexDecisionPort;
  onNavigate?: ProjectSearchProps['onNavigate'];
  preparation?: PreparationCounts;
  readiness?: SemanticReadiness;
  readyCount?: number;
  semanticApi?: SemanticSearchPort;
}

function renderSearch(api: ExactSearchPort, options: RenderOptions = {}) {
  const queryClient = createTestQueryClient();
  const QueryWrapper = queryWrapper(queryClient);
  const onNavigate = options.onNavigate ?? vi.fn(async (_intent: SearchNavigationIntent) => true);
  const decisions = options.decisions ?? indexDecisionApi();
  const semantic = options.semanticApi ?? semanticSearchApi();
  const element = (focusRevision: number) => (
    <QueryWrapper>
      <ProjectSearch
        active
        activeFolderPath="/project/research"
        decisionApi={decisions}
        exactApi={api}
        focusRevision={focusRevision}
        indexWarning={options.indexWarning ?? null}
        onNavigate={onNavigate}
        onConfigureSearch={options.onConfigureSearch}
        preparation={options.preparation ?? noPreparation}
        readiness={options.readiness ?? READY_INDEX}
        readyCount={options.readyCount ?? 5}
        semanticApi={semantic}
      />
    </QueryWrapper>
  );
  const rendered = render(element(0));
  return { ...rendered, decisions, element, onNavigate, queryClient };
}

describe('Library Search', () => {
  it('searches only the active workspace and presents occurrence evidence', async () => {
    const api = exactSearchApi({ search: vi.fn(async () => result) });
    const rendered = renderSearch(api);
    const input = screen.getByRole('combobox', { name: 'Search current workspace' });

    await userEvent.setup().type(input, 'answer');

    const option = await screen.findByRole('option', {
      name: /answer\.md, notes, Line 7, The answer is preserved here\./u,
    });
    expect(api.search).toHaveBeenCalledWith(
      {
        caseSensitive: false,
        folderPath: '/project/research',
        query: 'answer',
        wholeWord: false,
      },
      expect.any(AbortSignal),
    );
    expect(within(option).getByRole('mark').textContent).toBe('answer');
    expect(screen.getByText('notes/')).not.toBeNull();
    expect(screen.getByText('2')).not.toBeNull();
    expect(screen.getByText(/Showing the first results from 2 matches/u)).not.toBeNull();

    await userEvent.setup().keyboard('{Enter}');
    await waitFor(() =>
      expect(rendered.onNavigate).toHaveBeenCalledWith({
        source: { folderPath: '/project/research', path: 'notes/answer.md' },
        target: {
          caseSensitive: false,
          line: 7,
          occurrenceIndex: 0,
          query: 'answer',
          wholeWord: false,
        },
        type: 'open-search-source',
      }),
    );
  });

  it('does not surface a result returned outside the selected workspace', async () => {
    const api = exactSearchApi({
      search: vi.fn(async () => ({
        ...result,
        files: [
          {
            ...resultFile,
            id: '/project/archive\u0000notes/answer.md',
            source: { folderPath: '/project/archive', path: 'notes/answer.md' },
          },
        ],
      })),
    });
    renderSearch(api);

    await userEvent
      .setup()
      .type(screen.getByRole('combobox', { name: 'Search current workspace' }), 'answer');

    expect(await screen.findByText('No exact matches.')).not.toBeNull();
    expect(screen.queryByRole('option', { name: /answer\.md/u })).toBeNull();
  });

  it('opens the keyboard-selected occurrence rather than only its file', async () => {
    const repeated: ExactSearchResult = {
      files: [
        {
          ...resultFile,
          matches: [
            {
              line: 7,
              ranges: [
                { end: 10, start: 4 },
                { end: 24, start: 18 },
              ],
              text: 'The answer keeps answer.',
            },
          ],
        },
      ],
      totalMatches: 2,
      truncated: false,
    };
    const api = exactSearchApi({ search: vi.fn(async () => repeated) });
    const rendered = renderSearch(api);
    const user = userEvent.setup();

    await user.type(screen.getByRole('combobox', { name: 'Search current workspace' }), 'answer');
    await screen.findAllByRole('option', { name: /answer\.md/u });
    await user.keyboard('{ArrowDown}{Enter}');

    await waitFor(() =>
      expect(rendered.onNavigate).toHaveBeenCalledWith(
        expect.objectContaining({
          target: expect.objectContaining({ occurrenceIndex: 1 }),
        }),
      ),
    );
  });

  it('focuses the query again whenever the search command revision changes', async () => {
    const api = exactSearchApi({ search: vi.fn(async () => result) });
    const rendered = renderSearch(api);
    const input = screen.getByRole('combobox', { name: 'Search current workspace' });
    const elsewhere = rendered.baseElement.ownerDocument.createElement('button');
    rendered.baseElement.append(elsewhere);
    elsewhere.focus();
    expectNotFocused(input);

    rendered.rerender(rendered.element(1));

    await waitFor(() => expectFocused(input));
  });

  it('cancels an obsolete request as soon as the query changes', async () => {
    let firstSignal: AbortSignal | undefined;
    const api = exactSearchApi({
      search: vi.fn((_request, signal) => {
        firstSignal ??= signal;
        return new Promise<ExactSearchResult>(() => undefined);
      }),
    });
    renderSearch(api);
    const user = userEvent.setup();
    const input = screen.getByRole('combobox', { name: 'Search current workspace' });

    await user.type(input, 'alpha');
    await waitFor(() => expect(api.search).toHaveBeenCalledOnce());
    await user.type(input, ' beta');

    await waitFor(() => expect(firstSignal?.aborted).toBe(true));
  });

  it('switches to search by meaning within the selected folder and navigates by chunk anchor', async () => {
    const semanticApi = semanticSearchApi({ search: vi.fn(async () => semanticResult) });
    const exactApi = exactSearchApi({ search: vi.fn(async () => result) });
    const rendered = renderSearch(exactApi, { semanticApi });
    const user = userEvent.setup();

    await user.click(screen.getByRole('tab', { name: 'By meaning' }));
    expect(screen.queryByRole('combobox', { name: 'Search scope' })).toBeNull();
    await user.type(screen.getByRole('combobox', { name: 'Search current workspace' }), 'answers');

    const option = await screen.findByRole('option', { name: /idea\.md, notes, Answers/u });
    expect(semanticApi.search).toHaveBeenCalledWith(
      { folderPath: '/project/research', query: 'answers', topK: 30 },
      expect.any(AbortSignal),
    );
    expect(exactApi.search).not.toHaveBeenCalled();
    expect(screen.queryByRole('group')).toBeNull();
    expect(within(option).queryByRole('mark')).toBeNull();

    await user.keyboard('{Enter}');
    await waitFor(() =>
      expect(rendered.onNavigate).toHaveBeenCalledWith({
        source: { folderPath: '/project/research', path: 'notes/idea.md' },
        target: {
          caseSensitive: false,
          line: 12,
          occurrenceIndex: 0,
          query: 'Meaningful chunk about answers.',
          wholeWord: false,
        },
        type: 'open-search-source',
      }),
    );
  });

  it('is keyword search alone until search by meaning is set up, with no mode to switch to', async () => {
    const semanticApi = semanticSearchApi({ search: vi.fn(async () => semanticResult) });
    const exactApi = exactSearchApi({ search: vi.fn(async () => result) });
    renderSearch(exactApi, { readiness: { state: 'not-set-up' }, semanticApi });
    const user = userEvent.setup();

    // No tab strip at all: a single mode needs no chooser, and nothing on the
    // surface names the mode the reader has not turned on.
    expect(screen.queryByRole('tab', { name: 'By meaning' })).toBeNull();
    expect(screen.queryByRole('tablist', { name: 'Search mode' })).toBeNull();
    expect(screen.queryByText(/set it up in StashBase Settings/u)).toBeNull();

    await user.type(screen.getByRole('combobox', { name: 'Search current workspace' }), 'answers');
    expect(await screen.findByRole('option', { name: /answer\.md/u })).not.toBeNull();
    expect(semanticApi.search).not.toHaveBeenCalled();
  });

  it('withholds the mode while the folder’s readiness is still unknown', () => {
    renderSearch(exactSearchApi({ search: vi.fn(async () => result) }), {
      readiness: { state: 'unknown' },
    });
    expect(screen.queryByRole('tab', { name: 'By meaning' })).toBeNull();
  });

  it('reports automatic search-by-meaning indexing progress', () => {
    const exactApi = exactSearchApi({ search: vi.fn(async () => result) });
    renderSearch(exactApi, {
      readiness: { partial: false, remaining: 40, state: 'indexing' },
    });
    expect(screen.getByText('Preparing files for search by meaning…')).not.toBeNull();
    expect(screen.getByText('40 files remaining.')).not.toBeNull();
  });

  it('surfaces the index warning with retry and dismiss', async () => {
    const exactApi = exactSearchApi({ search: vi.fn(async () => result) });
    const rendered = renderSearch(exactApi, {
      readiness: { state: 'failed', warning: 'daemon restarted' },
    });

    expect(screen.getByText('Search may be incomplete: daemon restarted')).not.toBeNull();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() =>
      expect(rendered.decisions.dismissWarning).toHaveBeenCalledWith(
        '/project/research',
        expect.any(AbortSignal),
      ),
    );
  });

  it('names a skipped folder while keyword search remains usable without an embedding key', async () => {
    const exactApi = exactSearchApi({ search: vi.fn(async () => result) });
    const warning = 'Library: Directory could not be read (EACCES). Existing index retained.';
    const rendered = renderSearch(exactApi, {
      indexWarning: warning,
      readiness: { state: 'not-set-up' },
    });
    const user = userEvent.setup();

    expect(screen.getByRole('alert').textContent).toContain(warning);
    expect(screen.queryByRole('tab', { name: 'By meaning' })).toBeNull();
    await user.type(screen.getByRole('combobox', { name: 'Search current workspace' }), 'answer');
    await waitFor(() => expect(screen.getByText('answer.md')).not.toBeNull());
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() =>
      expect(rendered.decisions.resync).toHaveBeenCalledWith(
        '/project/research',
        expect.any(AbortSignal),
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() =>
      expect(rendered.decisions.dismissWarning).toHaveBeenCalledWith(
        '/project/research',
        expect.any(AbortSignal),
      ),
    );
  });
});

it('offers search setup without sending a semantic query or losing the current keyword query', async () => {
  const onConfigureSearch = vi.fn();
  const semanticApi = semanticSearchApi();
  renderSearch(exactSearchApi(), {
    readiness: { state: 'not-set-up' },
    onConfigureSearch,
    semanticApi,
  });
  const user = userEvent.setup();
  const input = screen.getByRole('combobox', { name: 'Search current workspace' });
  await user.type(input, 'draft');
  await user.click(screen.getByRole('button', { name: 'Set up search by meaning' }));
  expect(onConfigureSearch).toHaveBeenCalledOnce();
  expect(input).toHaveProperty('value', 'draft');
  expect(semanticApi.search).not.toHaveBeenCalled();
});
