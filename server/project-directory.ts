import { runWithFolderRoot } from './folder.ts';
import { filesystemPath } from './filesystem-path.ts';
import { listImmediateDirectoryAsync } from './file-listing.ts';
import {
  normalizeProjectDirectoryPath,
  routeError,
  type ProjectDirectoryEntry,
} from './project-file-access.ts';

export async function listProjectDirectory(rawPath: unknown): Promise<{ path: string; entries: ProjectDirectoryEntry[] }> {
  const target = await normalizeProjectDirectoryPath(rawPath);
  const folderRoot = target.folderRoot;
  return runWithFolderRoot(folderRoot, async () => {
    const prefix = target.folderRel ? target.folderRel.replace(/\/+$/, '') : '';
    let entries: Awaited<ReturnType<typeof listImmediateDirectoryAsync>>;
    try { entries = await listImmediateDirectoryAsync(prefix); }
    catch { throw routeError('directory not found', 404); }
    return {
      path: target.abs ?? folderRoot,
      entries: entries.map((entry): ProjectDirectoryEntry => ({
        ...entry,
        path: filesystemPath.join(folderRoot, entry.path),
      })),
    };
  });
}
