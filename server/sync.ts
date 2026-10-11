/**
 * Folder reconcile for one explicit project folder.
 *
 * StashBase enumerates admissible visible sources and prepares their complete
 * text projections. MFS owns projection hashing, unchanged detection,
 * document status, chunking, embedding, and publication. Every direct text
 * projection is offered idempotently; MFS returns `unchanged` without
 * embedding it again. Documents absent from the current source set are
 * removed by DocumentId.
 *
 * Sources are offered in bounded batches that yield the shared event loop,
 * and per-file reads are asynchronous, so one large Folder cannot stall the
 * HTTP routes serving the window that opened it.
 */
import fs from 'node:fs';
import { isMfsDaemonRetiringError } from './mfs-daemon.ts';
import {
  discoverConvertibleSources,
  indexFreshConvertibleSource,
} from './conversion-dispatch.ts';
import { cancelConversion, collectSourceCandidates } from './conversion.ts';
import type { Indexer, IndexUpsertResult } from './indexer.ts';
import { logger, errorMessage } from './log.ts';
import {
  indexableFileSizeErrorAsync,
  isRetrievalEligiblePath,
  RECONCILE_BATCH_SIZE,
  shouldIndexFilePath,
  yieldToEventLoop,
} from './indexable.ts';
import { detectFormat, isConvertibleSource } from './format.ts';
import { clearRecord } from './conversion-status.ts';
import { deleteDerivedForSource, knownDerivedSourcesUnderFolder } from './derived-store.ts';
import { filesystemPath } from './filesystem-path.ts';
import type { SyncResult } from '../shared/sync.ts';
import { decodeDirectTextBytes } from './text-decoding.ts';

export type { SyncResult } from '../shared/sync.ts';

const log = logger('sync');

function folderRelOf(root: string, abs: string): string | null {
  const rel = filesystemPath.relative(root, abs);
  return rel === '' ? null : rel;
}

async function readTextAt(root: string, abs: string): Promise<string | null> {
  const rel = filesystemPath.relative(root, abs);
  if (rel == null || rel === '') return null;
  try { return decodeDirectTextBytes(rel, await fs.promises.readFile(abs)); } catch { return null; }
}

export interface SyncOptions {
  /** Cooperative cancellation between MFS operations. */
  shouldContinue?: () => boolean;
}

function emptyResult(cancelled = false): SyncResult {
  return {
    added: [],
    modified: [],
    removed: [],
    failed: [],
    ...(cancelled ? { cancelled: true } : {}),
  };
}

function shouldStop(opts: SyncOptions | undefined): boolean {
  return opts?.shouldContinue ? !opts.shouldContinue() : false;
}

function toFolderRelList(root: string, paths: string[]): string[] {
  return paths.map((candidate) => folderRelOf(root, candidate) ?? candidate);
}

function toFolderRelFailures(
  root: string,
  failed: Array<{ name: string; error: string }>,
): Array<{ name: string; error: string }> {
  return failed.map((failure) => ({
    ...failure,
    name: folderRelOf(root, failure.name) ?? failure.name,
  }));
}

/** Product-owned admission walk. MFS receives only the resulting complete
 * projections, so it never traverses the user's Folder in this integration. */
async function collectCurrentSources(root: string): Promise<string[]> {
  const candidates = await collectSourceCandidates(
    root,
    (name) => detectFormat(name) !== null || isConvertibleSource(name),
  );
  return candidates
    .filter((sourcePath) => {
      const rel = folderRelOf(root, sourcePath);
      return rel != null && isRetrievalEligiblePath(rel);
    })
    .sort((left, right) => left.localeCompare(right));
}

function cleanupRemovedSource(sourcePath: string): void {
  if (!isConvertibleSource(sourcePath)) return;
  try { cancelConversion(sourcePath); } catch { /* best effort */ }
  try { clearRecord(sourcePath); } catch { /* best effort */ }
  try { deleteDerivedForSource(sourcePath); } catch (err: unknown) {
    log.warn(`removed-source cleanup failed for ${sourcePath}:`, err);
  }
}

function cleanupMissingConvertedSources(root: string): void {
  for (const sourcePath of knownDerivedSourcesUnderFolder(root)) {
    const folderRel = folderRelOf(root, sourcePath);
    if (folderRel != null && isRetrievalEligiblePath(folderRel) && fs.existsSync(sourcePath)) continue;
    cleanupRemovedSource(sourcePath);
  }
}

function sourceIdentities(paths: readonly string[]): Set<string> {
  return new Set(paths.map((sourcePath) => filesystemPath.identity(sourcePath)));
}

async function removeAbsentDocuments(
  indexer: Indexer,
  currentSources: ReadonlySet<string>,
  indexedDocuments: readonly string[],
  removed: string[],
  failed: Array<{ name: string; error: string }>,
  opts: SyncOptions,
): Promise<boolean> {
  let removedSinceYield = 0;
  for (const sourcePath of indexedDocuments) {
    if (currentSources.has(filesystemPath.identity(sourcePath))) continue;
    if (removedSinceYield >= RECONCILE_BATCH_SIZE) {
      removedSinceYield = 0;
      await yieldToEventLoop();
    }
    removedSinceYield += 1;
    if (shouldStop(opts)) return false;
    try {
      cleanupRemovedSource(sourcePath);
      await indexer.deleteFile(sourcePath);
      removed.push(sourcePath);
    } catch (err: unknown) {
      if (isMfsDaemonRetiringError(err)) throw err;
      failed.push({ name: sourcePath, error: `stale projection cleanup failed: ${errorMessage(err)}` });
    }
  }
  return true;
}

function recordMutation(
  sourcePath: string,
  result: IndexUpsertResult,
  existing: ReadonlySet<string>,
  added: string[],
  modified: string[],
  removed: string[],
): void {
  if (result.outcome === 'added') added.push(sourcePath);
  else if (result.outcome === 'updated') modified.push(sourcePath);
  else if (result.outcome === 'removed' && existing.has(filesystemPath.identity(sourcePath))) {
    removed.push(sourcePath);
  }
}

async function indexDirectSource(
  indexer: Indexer,
  root: string,
  sourcePath: string,
  failed: Array<{ name: string; error: string }>,
): Promise<IndexUpsertResult> {
  const folderRel = folderRelOf(root, sourcePath);
  if (folderRel == null || !shouldIndexFilePath(folderRel)) {
    await indexer.deleteFile(sourcePath);
    return { outcome: 'removed' };
  }
  const tooLarge = await indexableFileSizeErrorAsync(sourcePath);
  if (tooLarge) {
    await indexer.deleteFile(sourcePath);
    failed.push({ name: sourcePath, error: tooLarge });
    return { outcome: 'removed' };
  }
  const content = await readTextAt(root, sourcePath);
  if (content == null) {
    await indexer.deleteFile(sourcePath);
    failed.push({ name: sourcePath, error: 'source text could not be decoded safely' });
    return { outcome: 'removed' };
  }
  try {
    return await indexer.upsertFile(sourcePath, content, { waitForIndex: false });
  } catch (err: unknown) {
    if (isMfsDaemonRetiringError(err)) throw err;
    const message = errorMessage(err);
    failed.push({ name: sourcePath, error: message });
    log.warn(`failed ${sourcePath}:`, err);
    return { outcome: 'unchanged' };
  }
}

/** Reconcile current StashBase projections into one Folder's Internal MFS
 * namespace. MFS decides added/updated/unchanged from projection content. */
export async function syncIndex(
  indexer: Indexer,
  root: string,
  opts: SyncOptions = {},
): Promise<SyncResult> {
  if (shouldStop(opts)) return emptyResult(true);

  const sources = await collectCurrentSources(root);
  const current = sourceIdentities(sources);
  const indexedDocuments = await indexer.listDocuments(root);
  const existing = sourceIdentities(indexedDocuments);
  const failed: Array<{ name: string; error: string }> = [];
  const added: string[] = [];
  const modified: string[] = [];
  const removed: string[] = [];

  cleanupMissingConvertedSources(root);
  if (!await removeAbsentDocuments(indexer, current, indexedDocuments, removed, failed, opts)) {
    return {
      ...emptyResult(true),
      removed: toFolderRelList(root, removed),
      failed: toFolderRelFailures(root, failed),
    };
  }

  const convertible = sources.filter((sourcePath) => isConvertibleSource(sourcePath));
  await discoverConvertibleSources(root, convertible);

  let offeredSinceYield = 0;
  for (const sourcePath of sources) {
    if (offeredSinceYield >= RECONCILE_BATCH_SIZE) {
      offeredSinceYield = 0;
      await yieldToEventLoop();
    }
    offeredSinceYield += 1;
    if (shouldStop(opts)) {
      return {
        added: toFolderRelList(root, added),
        modified: toFolderRelList(root, modified),
        removed: toFolderRelList(root, removed),
        failed: toFolderRelFailures(root, failed),
        cancelled: true,
      };
    }
    if (isConvertibleSource(sourcePath)) {
      try {
        const result = await indexFreshConvertibleSource(sourcePath);
        if (result) {
          recordMutation(sourcePath, result, existing, added, modified, removed);
        } else if (existing.has(filesystemPath.identity(sourcePath))) {
          await indexer.deleteFile(sourcePath);
          removed.push(sourcePath);
        }
      } catch (err: unknown) {
        if (isMfsDaemonRetiringError(err)) throw err;
        failed.push({ name: sourcePath, error: errorMessage(err) });
      }
      continue;
    }
    const result = await indexDirectSource(indexer, root, sourcePath, failed);
    recordMutation(sourcePath, result, existing, added, modified, removed);
  }

  log.info(
    `done. offered=${sources.length} `
      + `added=${added.length} modified=${modified.length} `
      + `removed=${removed.length} failed=${failed.length}`,
  );
  return {
    added: toFolderRelList(root, added),
    modified: toFolderRelList(root, modified),
    removed: toFolderRelList(root, removed),
    failed: toFolderRelFailures(root, failed),
  };
}
