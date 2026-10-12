/**
 * Shared rename machinery used by both the file and folder rename
 * routes:
 *   - `renameWithRollback` — disk-first, index-second, with rollback
 *     of the disk rename if the index step fails.
 *   - `bundleRenameEntryAsync` — when a note `<stem>.{md,html}` moves, its
 *     `<stem>_files/` sidecar (the dir holding iframe assets) also
 *     moves; this builds the folder-style rename entry the link
 *     cascade needs to rewrite external pointers into the bundle.
 */
import express from 'express';
import { pathExistsAsync } from './active-file-operations.ts';
import type { RenameEntry } from './links.ts';
import { logger, errorMessage } from './log.ts';
import { sendError } from './http.ts';

const log = logger('rename');

/** Two-step rename with rollback: disk first, then index. If index
 *  fails we undo disk; if undo also fails we surface a 500 with an
 *  actionable reconciliation hint. */
export async function renameWithRollback(opts: {
  kind: 'file' | 'folder';
  from: string;
  to: string;
  res: express.Response;
  doDisk: () => void | Promise<void>;
  undoDisk: () => void | Promise<void>;
  doIndex: () => Promise<void>;
  /** Lazy so callers can include values computed inside `doIndex`
   *  (e.g. the file rename returns a `linksUpdated` count that the
   *  cascade step produces). */
  okResponse: () => Record<string, unknown>;
}): Promise<void> {
  const { kind, from, to, res, doDisk, undoDisk, doIndex, okResponse } = opts;
  try {
    await doDisk();
  } catch (err: unknown) {
    sendError(res, err);
    return;
  }
  try {
    await doIndex();
    res.json(okResponse());
  } catch (err: unknown) {
    log.warn(`${kind} rename: index update failed for ${from} → ${to}:`, err);
    try {
      await undoDisk();
    } catch (rb: unknown) {
      log.warn(
        `${kind} rename: rollback failed; disk is at ${to} but index still references ${from}. ` +
          `POST /api/sync to reconcile. (${errorMessage(rb)})`,
      );
      res.status(500).json({
        error: 'rename half-applied — call POST /api/sync to reconcile',
        [kind === 'file' ? 'name' : 'path']: to,
      });
      return;
    }
    sendError(res, err);
  }
}

/** When a note `<stem>.{md,html}` is renamed, `renameOnDiskAsync` also
 *  moves its sidecar bundle `<stem>_files/` (the dir that holds the
 *  iframe's images / CSS). Build a folder-style rename entry so the
 *  cascade rewrites any external links into that bundle. The
 *  `present` flag selects which end of the rename to probe on disk —
 *  cascade runs post-rename (`'post'`), preview runs pre-rename
 *  (`'pre'`). Returns null when there's no bundle to track. */
export async function bundleRenameEntryAsync(
  oldName: string,
  newName: string,
  present: 'pre' | 'post',
): Promise<RenameEntry | null> {
  const stemRe = /\.(md|markdown|html|htm)$/i;
  const oldStem = oldName.replace(stemRe, '');
  const newStem = newName.replace(stemRe, '');
  if (oldStem === newStem) return null;
  const oldBundle = oldStem + '_files';
  const newBundle = newStem + '_files';
  const probe = present === 'pre' ? oldBundle : newBundle;
  if (!(await pathExistsAsync(probe))) return null;
  return { kind: 'folder', old: oldBundle, new: newBundle };
}
