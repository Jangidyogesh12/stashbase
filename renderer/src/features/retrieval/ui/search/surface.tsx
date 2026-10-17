/**
 * The workspace search surface.
 *
 * It owns one query field, one tab per registered backend, the search-by-meaning and
 * preparation notices, and the selected backend's rows. Everything a backend
 * differs by — its request, its rows, its copy, its readiness gate — comes
 * from the registry entry, so this module has no per-backend branch.
 */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';

import { Button } from '@/components/ui/button';
import { CommandList } from '@/components/ui/command-menu';
import { InputField, InputGroup } from '@/components/ui/input-group';
import { retrievalFailure } from '@/features/retrieval/application/failure-messages';
import type { IndexDecisionPort } from '@/features/retrieval/application/ports';
import { retrievalQueryKeys } from '@/features/retrieval/application/queries';
import type { SearchNavigationIntent } from '@/features/retrieval/domain/exact-search';
import {
  preparationReadinessLine,
  semanticIndexNotice,
  type PreparationCounts,
  type SemanticReadiness,
} from '@/features/retrieval/domain/semantic-readiness';
import { useDebouncedQuery } from '@/features/retrieval/hooks/use-debounced-query';
import { useIndexDecisions } from '@/features/retrieval/hooks/use-index-decisions';
import {
  PreparationReadinessNotice,
  SemanticReadinessNotice,
} from '@/features/retrieval/ui/readiness-notices';
import { listNavigationTarget } from '@/shared/utils/list-cursor';

import {
  backendReady,
  selectedBackend,
  type SearchBackendRegistry,
  type SearchRequestContext,
  type SearchRowsView,
} from './backend';
import { FooterNote, SearchFailure, StatusLine } from './status-line';
import { SearchTabStrip } from './tab-strip';

const RESULT_PAGE_SIZE = 6;
const INPUT_LABEL = 'Search current workspace';

export interface SearchSurfaceProps {
  active: boolean;
  backends: SearchBackendRegistry;
  decisionApi: IndexDecisionPort;
  focusRevision: number;
  folderPath: string;
  onConfigureSearch?: (() => void) | undefined;
  onNavigate(intent: SearchNavigationIntent): Promise<boolean>;
  preparation: PreparationCounts;
  readiness: SemanticReadiness;
  /** Visible sources already searchable, for the preparation line. */
  readyCount: number;
}

export function SearchSurface({
  active,
  backends,
  decisionApi,
  focusRevision,
  folderPath,
  onNavigate,
  onConfigureSearch,
  preparation,
  readiness,
  readyCount,
}: SearchSurfaceProps) {
  const [backendId, setBackendId] = useState(backends[0].id);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [navigationFailure, setNavigationFailure] = useState(false);
  const inputGroup = useRef<HTMLDivElement | null>(null);
  const resultsId = useId();
  const trimmedQuery = query.trim();
  const decisions = useIndexDecisions(decisionApi, folderPath);

  const backend = selectedBackend(backends, backendId);
  const ready = backendReady(backend, readiness);
  const lane = useMemo(() => {
    if (!ready || !trimmedQuery) return null;
    const context: SearchRequestContext = { folderPath, query: trimmedQuery, readiness };
    return backend.lane(context);
  }, [backend, folderPath, ready, readiness, trimmedQuery]);
  const run = useDebouncedQuery({
    cancelKey: retrievalQueryKeys.all,
    delayMs: backend.delayMs,
    lane,
  });

  const rows = lane === null ? null : (run.data ?? null);
  const count = rows?.count ?? 0;
  const searching = lane !== null && (run.isSettling || run.isFetching);
  const notice = semanticIndexNotice(readiness);
  const preparationLine = preparationReadinessLine(preparation, readyCount);

  useEffect(() => setActiveIndex(0), [backendId, folderPath, query, run.data]);

  useEffect(() => {
    if (!active) return;
    const frame = requestAnimationFrame(() => inputGroup.current?.querySelector('input')?.focus());
    return () => cancelAnimationFrame(frame);
  }, [active, focusRevision]);

  const navigate = async (intent: SearchNavigationIntent) => {
    setNavigationFailure(false);
    try {
      if (await onNavigate(intent)) return;
    } catch {
      // The local recovery below intentionally excludes filesystem details.
    }
    setNavigationFailure(true);
  };

  const open = (index: number) => {
    const intent = rows?.intent(index) ?? null;
    if (intent) void navigate(intent);
  };

  const view: SearchRowsView = {
    activeIndex,
    onOpen: open,
    rowId: (index) => `${resultsId}-${index}`,
  };

  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Enter' && run.isSettling) {
      event.preventDefault();
      run.submit();
      return;
    }
    if (count === 0) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      open(activeIndex);
      return;
    }
    const target = listNavigationTarget(event.key, {
      activeIndex,
      count,
      pageSize: RESULT_PAGE_SIZE,
    });
    if (target === null) return;
    event.preventDefault();
    setActiveIndex(target);
  };

  return (
    <section aria-label={backend.surfaceLabel} className="flex h-full min-h-0 flex-col">
      {/* p-2: the 8px above the field is the same step the tree region's own
       *  group keeps above its first row, so Files, Document outline and
       *  Search all start on one line under the navigator's strip. The 8px at
       *  the sides puts the magnifier on the sidebar's shared 16px glyph
       *  column, level with the tree's file glyphs. */}
      <div className="shrink-0 p-2">
        <InputGroup className="w-full gap-0" ref={inputGroup} size="compact">
          <InputField
            aria-activedescendant={count > activeIndex ? `${resultsId}-${activeIndex}` : undefined}
            aria-autocomplete="list"
            aria-controls={count > 0 ? resultsId : undefined}
            aria-expanded={count > 0}
            aria-keyshortcuts="Meta+Shift+F Control+Shift+F"
            autoComplete="off"
            label={INPUT_LABEL}
            labelHidden
            onChange={setQuery}
            onKeyDown={onInputKeyDown}
            placeholder={backend.placeholder}
            resting="outline"
            role="combobox"
            spellCheck={false}
            value={query}
          />
        </InputGroup>
        {/* mt-1.5: the same step the tab strip keeps below the field, so
         *  the button's hover fill sits apart from the field's border. */}
        {readiness.state === 'not-set-up' && onConfigureSearch && (
          <Button className="mt-1.5" variant="ghost" size="compact" onClick={onConfigureSearch}>
            Set up search by meaning
          </Button>
        )}
        {backends.length > 1 && (
          <div className="flex items-center pt-1.5">
            <SearchTabStrip
              backends={backends}
              onSelect={setBackendId}
              readiness={readiness}
              selectedId={backend.id}
            />
          </div>
        )}
      </div>

      {notice && (notice.persistent || backend.indexGate !== undefined) && (
        <SemanticReadinessNotice
          error={decisions.error}
          notice={notice}
          onDecision={decisions.run}
          pendingAction={decisions.pendingAction}
        />
      )}

      {preparationLine && <PreparationReadinessNotice line={preparationLine} />}

      {lane && searching && <StatusLine>Searching…</StatusLine>}

      {lane && !searching && run.isError && (
        <SearchFailure message={retrievalFailure(run.error).message} onRetry={run.refetch} />
      )}

      {lane && !searching && run.isSuccess && count === 0 && (
        <StatusLine>{backend.emptyMessage}</StatusLine>
      )}

      {rows && !searching && count > 0 && (
        <CommandList
          activeIndex={activeIndex}
          aria-label={backend.resultsLabel}
          className="max-h-none min-h-0 flex-1"
          id={resultsId}
          onActiveIndexChange={setActiveIndex}
        >
          {rows.render(view)}
        </CommandList>
      )}

      {rows && !searching && rows.note && <FooterNote tone="muted">{rows.note}</FooterNote>}

      {navigationFailure && (
        <FooterNote tone="error">
          Could not open this source. Your current document remains available.
        </FooterNote>
      )}
    </section>
  );
}
