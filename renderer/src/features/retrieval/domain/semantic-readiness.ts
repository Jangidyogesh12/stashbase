/**
 * Search-by-meaning readiness for the search surface.
 *
 * The states arrive already reduced: the shell hands search one variant per
 * observable state. Semantic state controls availability; folder reconciliation
 * warnings independently inform both search modes. Nothing here reaches for
 * the daemon's own status shape.
 */

export type SemanticReadinessAction = 'dismiss-warning' | 'retry-index';

export type SemanticReadiness =
  | { readonly state: 'failed'; readonly warning: string }
  /** `partial` marks an index that already answers while the rest builds. */
  | { readonly partial: boolean; readonly remaining: number; readonly state: 'indexing' }
  | { readonly state: 'not-set-up' }
  | { readonly state: 'ready' }
  | { readonly state: 'unknown' };

/** Whether search by meaning may run now. Keyword search never depends on it. */
export function canSemanticSearch(readiness: SemanticReadiness): boolean {
  switch (readiness.state) {
    case 'failed':
    case 'ready':
      return true;
    case 'indexing':
      return readiness.partial;
    case 'not-set-up':
    case 'unknown':
      return false;
  }
}

export interface SemanticIndexNotice {
  readonly actions: readonly SemanticReadinessAction[];
  readonly detail: string | null;
  /** Shown whichever search backend is selected, because it explains an
   *  index the reader has not resolved yet. */
  readonly persistent: boolean;
  /** Drawn in its own box rather than as a quiet line. */
  readonly prominent: boolean;
  readonly title: string;
  readonly tone: 'attention' | 'neutral';
}

/** Folder reconciliation warnings apply to both modes, independently of
 *  search-by-meaning setup. Otherwise report semantic readiness. */
export function semanticIndexNotice(
  readiness: SemanticReadiness,
  indexWarning: string | null = null,
): SemanticIndexNotice | null {
  if (indexWarning !== null) return indexWarningNotice(indexWarning);
  switch (readiness.state) {
    case 'failed':
      return indexWarningNotice(readiness.warning);
    case 'indexing':
      return {
        actions: [],
        detail:
          readiness.remaining > 0
            ? `${readiness.remaining} ${readiness.remaining === 1 ? 'file' : 'files'} remaining.`
            : null,
        persistent: true,
        prominent: false,
        title: 'Preparing files for search by meaning…',
        tone: 'neutral',
      };
    // Not set up has nothing to say: the mode is not offered until it is
    // turned on in Settings, and the search surface never names it before.
    case 'not-set-up':
    case 'ready':
    case 'unknown':
      return null;
  }
}

function indexWarningNotice(warning: string): SemanticIndexNotice {
  return {
    actions: ['retry-index', 'dismiss-warning'],
    detail: `Search may be incomplete: ${warning}`,
    persistent: true,
    prominent: false,
    title: 'Search needs attention',
    tone: 'attention',
  };
}

export interface PreparationCounts {
  readonly cancelled: number;
  readonly failed: number;
  readonly pending: number;
}

export interface PreparationReadinessLine {
  readonly detail: string;
  readonly title: string;
  readonly tone: 'attention' | 'progress';
}

function plural(count: number, noun: string): string {
  return `${count} ${count === 1 ? noun : `${noun}s`}`;
}

/** The Task 43 search line: only preparation, never search by meaning. */
export function preparationReadinessLine(
  counts: PreparationCounts,
  readyCount: number,
): PreparationReadinessLine | null {
  if (counts.failed > 0 || counts.cancelled > 0) {
    const parts = [
      counts.failed > 0 ? `${counts.failed} failed` : null,
      counts.cancelled > 0 ? `${counts.cancelled} cancelled` : null,
    ].filter((part): part is string => part !== null);
    return {
      detail: `${parts.join(' · ')}. Open a file to retry it.`,
      title:
        counts.failed > 0
          ? 'Some files could not be prepared for search.'
          : 'Some file preparation was cancelled.',
      tone: 'attention',
    };
  }
  if (counts.pending > 0) {
    return {
      detail: `${plural(readyCount, 'file')} ready to search. ${counts.pending} still being prepared.`,
      title: 'Preparing text for search',
      tone: 'progress',
    };
  }
  return null;
}
