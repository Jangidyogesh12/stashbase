/**
 * What a folder's preparation and search-by-meaning snapshot means for searching it.
 *
 * Preparation owns this projection because it owns the snapshot. Search reads
 * the projection and never the snapshot, so the retrieval surfaces cannot
 * consult a field the daemon happens to send beside the state they asked
 * about. Everything here is a fact; the sentences a reader sees are written
 * where they are shown.
 */
import type { FolderIndexStatus, SemanticIndexStatus } from '@/shared/domain/folder-index-status';

import { folderPreparationSummary, type FolderPreparationSummary } from './readiness';

/** The search-by-meaning answer a search surface asks for: whether it can serve a
 *  query, and what it should say if it cannot. It is the daemon's own set of
 *  states with two differences — a failed index carries the warning that
 *  explains it, and `unknown` names the folder whose status has not arrived,
 *  which no daemon state spells. */
type SemanticSearchReadiness =
  | Exclude<SemanticIndexStatus, { state: 'failed' }>
  | { readonly state: 'failed'; readonly warning: string }
  | { readonly state: 'unknown' };

export interface FolderSearchReadiness {
  /** How many visible sources are in each preparation state. */
  readonly counts: FolderPreparationSummary;
  /** Reconciliation failures affect keyword search even without an embedding key. */
  readonly indexWarning: string | null;
  /** Visible sources already searchable. */
  readonly readyCount: number;
  readonly semantic: SemanticSearchReadiness;
}

/** Every state but one travels as the daemon reported it. `failed` is the
 *  exception: on its own it says nothing a reader can act on, so it carries
 *  the folder's warning — and a folder marked failed before that warning
 *  arrives has nothing to say at all, so search behaves as ready. */
function semanticSearchReadiness(status: FolderIndexStatus): SemanticSearchReadiness {
  const semantic = status.semantic;
  if (semantic.state !== 'failed') return semantic;
  return status.indexWarning
    ? { state: 'failed', warning: status.indexWarning.sentence }
    : { state: 'ready' };
}

/** The whole search answer for one folder, or the unknown folder before its
 *  first status arrives. */
export function folderSearchReadiness(
  status: FolderIndexStatus | null | undefined,
): FolderSearchReadiness {
  const counts = folderPreparationSummary(status);
  if (!status) return { counts, indexWarning: null, readyCount: 0, semantic: { state: 'unknown' } };
  return {
    counts,
    indexWarning: status.indexWarning?.sentence ?? null,
    readyCount: Math.max(0, status.total - counts.pending),
    semantic: semanticSearchReadiness(status),
  };
}
