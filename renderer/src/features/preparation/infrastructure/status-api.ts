import {
  PreparationError,
  type PreparationStatusPort,
} from '@/features/preparation/application/ports';
import { request, type TransportFailure } from '@/platform/http/classify';
import type { HttpClient } from '@/platform/http/client';
import {
  indexStatusFailureSchema,
  indexStatusResponseSchema,
  type IndexStatusResponseWire,
} from '@/protocols/http/index-status';
import type {
  FolderIndexStatus,
  PreparationProgress,
  SemanticIndexStatus,
} from '@/shared/domain/folder-index-status';

/** Drops absent extraction counters instead of carrying explicit `undefined`
 *  keys across the wire-to-domain boundary. */
function mapConversionProgress(
  wire: IndexStatusResponseWire['conversionProgress'],
): Readonly<Record<string, PreparationProgress>> {
  const mapped: Record<string, PreparationProgress> = {};
  for (const [path, progress] of Object.entries(wire)) {
    mapped[path] =
      progress.phase === 'extracting'
        ? {
            phase: 'extracting',
            ...(progress.currentPage === undefined ? {} : { currentPage: progress.currentPage }),
          }
        : progress;
  }
  return mapped;
}

/** Folds the daemon's index states into the variants the renderer models,
 *  so a flag can never be read beside the state it belongs to. The partial
 *  spellings differ from their whole counterparts only in whether the index
 *  already answers, which is what `partial` carries. */
function mapSemanticStatus(wire: IndexStatusResponseWire): SemanticIndexStatus {
  const indexing = wire.semanticIndexing;
  switch (indexing.state) {
    case 'disabled':
      return { state: 'not-set-up' };
    case 'indexing':
    case 'partial-indexing':
      return {
        partial: indexing.state === 'partial-indexing',
        remaining: wire.pending.length,
        state: 'indexing',
      };
    case 'failed':
      return { state: 'failed' };
    case 'ready':
      return { state: 'ready' };
  }
}

function mapIndexStatus(wire: IndexStatusResponseWire): FolderIndexStatus {
  return {
    conversionProgress: mapConversionProgress(wire.conversionProgress),
    conversionRevision: wire.conversionRevision,
    conversionVersions: wire.conversionVersions,
    folderPath: wire.folder,
    indexSettled: wire.visibleIndexingSettled,
    indexWarning: wire.indexWarning && {
      at: wire.indexWarning.at,
      sentence: wire.indexWarning.message,
    },
    indexed: wire.indexed,
    pendingConversions: wire.pendingConversions,
    preparationFailures: wire.preparationFailures,
    semantic: mapSemanticStatus(wire),
    total: wire.total,
    treeVersion: wire.treeVersion,
  };
}

const SCOPE_LOST = 'This folder is no longer available in this window.';

/** The daemon also names a vanished folder in the failure body, ahead of any
 *  status the shared ladder could read. */
function scopeFailure({ response, serverMessage }: TransportFailure): PreparationError | null {
  const failure = indexStatusFailureSchema.safeParse(response.body);
  if (failure.data?.code !== 'FOLDER_NOT_FOUND' && failure.data?.code !== 'NO_FOLDER') return null;
  return new PreparationError(
    'scope-lost',
    SCOPE_LOST,
    serverMessage === null ? undefined : { cause: new Error(serverMessage) },
  );
}

export function createPreparationStatusAdapter(client: HttpClient): PreparationStatusPort {
  return {
    async load(folderPath, signal) {
      const query = new URLSearchParams({ folder: folderPath });
      return mapIndexStatus(
        await request(client, {
          error: PreparationError,
          failure: scopeFailure,
          failureSchema: indexStatusFailureSchema,
          path: `/api/index-status?${query}`,
          schema: indexStatusResponseSchema,
          signal,
        }),
      );
    },
  };
}
