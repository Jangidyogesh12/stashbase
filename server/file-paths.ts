import fs from 'node:fs';
import path from 'node:path';
import { requireCurrentFolder } from './folder.ts';
import { filesystemPath, type PathAccess } from './filesystem-path.ts';
import { normalizeFolderRelativePath, type FolderRelativePathOptions } from './folder-relative-path.ts';

/** Resolve the current folder root every time we touch the FS — the user
 *  can switch folders at runtime from the welcome screen, so caching the
 *  path at module load would silently keep writing to the old folder. */
export function folderRoot(): string {
  return requireCurrentFolder();
}

/** Basename of the currently-open folder. The web UI shows this as
 *  the folder label at the top of the sidebar. */
export function getCurrentFolderBasename(): string {
  return path.basename(folderRoot());
}

/** Quietly transform a user-supplied filename so it survives writing
 *  to disk on any sane filesystem. Used at create / rename time only —
 *  reads still pass through `safePath` verbatim, so folders imported
 *  from other tools that already have `:` in filenames keep working. */
export function sanitizeFilename(name: string): string {
  return name
    .split('/')
    .map((seg) => seg.replace(/[:?*<>|\\]/g, '-'))
    .join('/')
    .normalize('NFC');
}

/** Resolve relative-to-folder path to an absolute filesystem path AND
 *  defend against any edge case where the result escapes the folder root. */
export function resolveSafe(
  rel: string,
  access: PathAccess = 'lexical',
  label = 'path',
  options: FolderRelativePathOptions = {},
): string {
  const safe = normalizeFolderRelativePath(rel, { allowQuotes: true, ...options });
  return filesystemPath.resolveUnder(folderRoot(), safe, { access, label });
}

/** Async request-path equivalent of `resolveSafe()`. Keep synchronous callers
 * for bounded background work and tests; HTTP/MCP adapters must use this seam
 * before touching an existing or creatable filesystem target. */
export function resolveSafeAsync(
  rel: string,
  access: PathAccess = 'lexical',
  label = 'path',
  options: FolderRelativePathOptions = {},
): Promise<string> {
  const safe = normalizeFolderRelativePath(rel, { allowQuotes: true, ...options });
  return filesystemPath.resolveUnderAsync(folderRoot(), safe, { access, label });
}

export async function isSameExistingPathAsync(oldRel: string, newRel: string): Promise<boolean> {
  let oldAbs: string;
  let newAbs: string;
  try {
    [oldAbs, newAbs] = await Promise.all([
      resolveSafeAsync(oldRel),
      resolveSafeAsync(newRel),
    ]);
  } catch {
    return false;
  }
  return filesystemPath.sameExistingPathAsync(oldAbs, newAbs);
}

async function uniqueRenameHopAsync(target: string): Promise<string> {
  const dir = path.dirname(target);
  const base = path.basename(target);
  for (let i = 0; i < 100; i += 1) {
    const candidate = path.join(dir, `.${base}.stashbase-rename-${process.pid}-${Date.now()}-${i}`);
    try {
      await fs.promises.access(candidate);
    } catch {
      return candidate;
    }
  }
  throw new Error('could not reserve temporary rename path');
}

export async function renameAbsPreservingCaseAsync(from: string, to: string): Promise<void> {
  if (from === to || !(await filesystemPath.sameExistingPathAsync(from, to))) {
    await fs.promises.rename(from, to);
    return;
  }
  const hop = await uniqueRenameHopAsync(to);
  await fs.promises.rename(from, hop);
  try {
    await fs.promises.rename(hop, to);
  } catch (err) {
    try { await fs.promises.rename(hop, from); } catch { /* preserve original error */ }
    throw err;
  }
}
