/** One creation owner for a complete, independently movable HTML note. */
import fs from 'node:fs';
import path from 'node:path';
import { resolveSafeAsync } from './file-paths.ts';
import { normalizeFolderRelativePath } from './folder-relative-path.ts';
import { noteTreeChanged } from './watcher.ts';
import { BLANK_INTERACTIVE_NOTE } from './interactive-note-template.ts';
import { normalizeProjectDirectoryPath, routeError } from './project-file-access.ts';
import { runWithFolderRoot } from './folder.ts';
import { filesystemPath } from './filesystem-path.ts';
import { interactiveNoteCreateRequestSchema } from '../shared/protocols/http/files.ts';

/** Agent/MCP entry retains ordinary registered-project and session authority. */
export async function createProjectInteractiveNote(input: { path: unknown; name?: unknown }) {
  const parent = await normalizeProjectDirectoryPath(input.path);
  const parsed = interactiveNoteCreateRequestSchema.safeParse({ parentPath: parent.folderRel, ...(input.name === undefined ? {} : { name: input.name }) });
  if (!parsed.success) throw routeError('Use a single folder name for the interactive note.', 400);
  const result = await runWithFolderRoot(parent.folderRoot, () => createInteractiveNote(parsed.data));
  return {
    path: filesystemPath.join(parent.folderRoot, result.path),
    entryPath: filesystemPath.join(parent.folderRoot, result.entryPath),
    dataPath: filesystemPath.join(parent.folderRoot, `${result.path}/assets/note.json`),
  };
}

export async function createInteractiveNote(input: { parentPath: string; name?: string }): Promise<{ path: string; entryPath: string }> {
  const parent = input.parentPath ? normalizeFolderRelativePath(input.parentPath, { writable: true, allowQuotes: true }) : '';
  if (input.name && /[\\/]/u.test(input.name)) throw Object.assign(new Error('Use a single folder name.'), { status: 400 });
  for (let ordinal = 1; ordinal <= 10_000; ordinal++) {
    const name = input.name ?? (ordinal === 1 ? 'Untitled' : `Untitled ${ordinal}`);
    const relative = normalizeFolderRelativePath(parent ? `${parent}/${name}` : name, { writable: true, allowQuotes: true });
    const target = await resolveSafeAsync(relative, 'creatable', 'interactive note', { writable: true });
    try {
      // mkdir without recursive claims exactly one directory and never merges
      // another window's note, even if the listing that initiated it was stale.
      await fs.promises.mkdir(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (input.name) throw Object.assign(new Error('A file or folder already uses that name.'), { status: 409 });
      continue;
    }
    const owned = new Map<string, string>();
    let assetsCreated = false;
    try {
      await resolveSafeAsync(relative, 'existing', 'interactive note', { writable: true });
      await fs.promises.mkdir(path.join(target, 'assets'));
      assetsCreated = true;
      // Publish the entry last: a visible HTML entry always has its initial data.
      for (const [leaf, content] of [
        ['assets/note.json', '{\n  "title": "",\n  "body": ""\n}\n'],
        ['index.html', BLANK_INTERACTIVE_NOTE],
      ]) {
        const absolute = await resolveSafeAsync(`${relative}/${leaf}`, 'creatable', 'note resource', { writable: true });
        await fs.promises.writeFile(absolute, content!, { flag: 'wx' });
        owned.set(absolute, content!);
      }
    } catch (error) {
      // Remove only unchanged files we wrote. Never recursively delete a
      // directory that another process may have added user work to.
      for (const [absolute, content] of owned) {
        if (await fs.promises.readFile(absolute, 'utf8').catch(() => null) === content)
          await fs.promises.unlink(absolute).catch(() => undefined);
      }
      if (assetsCreated) await fs.promises.rmdir(path.join(target, 'assets')).catch(() => undefined);
      await fs.promises.rmdir(target).catch(() => undefined);
      noteTreeChanged();
      throw error;
    }
    noteTreeChanged();
    return { path: relative, entryPath: `${relative}/index.html` };
  }
  throw new Error('Could not find a free name for the interactive note.');
}
